"""
Reproducible Offline Recommendation Evaluation Suite.

Defines a defensible, transparent evaluation protocol for unsupervised partner matching:
- Relevance Ground Truth Proxy: A candidate is deemed relevant to a query user if they
  share at least one primary programming language AND belong to the same project cluster domain.
- Ranking & Retrieval Metrics: Precision@K, Recall@K, Mean Average Precision (MAP@K).
- Quality Metrics: Intra-List Diversity (ILD) and Catalog Coverage (%).
- Comparative Weight Study: Empirically evaluates different component weight distributions.
"""

from typing import Any, Dict, List, Set, Tuple
import numpy as np
import pandas as pd

from backend.engine import RecommendationEngine


def parse_languages(lang_input: Any) -> Set[str]:
    """Parse language string or list into sanitized lowercase set."""
    if lang_input is None:
        return set()
    if isinstance(lang_input, (list, tuple, set)):
        return {
            str(l).strip().lower()
            for l in lang_input
            if str(l).strip() and str(l).strip().lower() != "unknown"
        }
    if isinstance(lang_input, str):
        return {
            l.strip().lower()
            for l in lang_input.split(",")
            if l.strip() and l.strip().lower() != "unknown"
        }
    return set()


class RecommendationEvaluator:
    def __init__(self, engine: RecommendationEngine):
        self.engine = engine
        self.df = engine.df.copy()

        # Merge HDBSCAN domain tags for ground truth domain alignment
        if not engine.hdbscan_df.empty:
            self.df = self.df.merge(
                engine.hdbscan_df[["Username", "Domain_Tag"]],
                on="Username",
                how="left"
            )
        else:
            self.df["Domain_Tag"] = "General"

        # Pre-parse language sets for every user
        self.user_langs = {
            row["Username"].lower(): parse_languages(row.get("Languages"))
            for _, row in self.df.iterrows()
        }
        self.user_domains = {
            row["Username"].lower(): str(row.get("Domain_Tag", "General"))
            for _, row in self.df.iterrows()
        }

    def is_relevant(self, query_user: str, candidate_user: str) -> bool:
        """
        Defensible relevance protocol:
        Candidate is relevant if they share >= 1 programming language
        AND share the same cluster domain.
        """
        q_user = query_user.lower()
        c_user = candidate_user.lower()
        if q_user == c_user:
            return False

        q_langs = self.user_langs.get(q_user, set())
        c_langs = self.user_langs.get(c_user, set())

        shared_langs = q_langs.intersection(c_langs)
        same_domain = (self.user_domains.get(q_user) == self.user_domains.get(c_user))

        return bool(shared_langs) and same_domain

    def evaluate_query(
        self,
        query_user: str,
        recommendations: List[Dict[str, Any]],
        k: int = 5
    ) -> Dict[str, float]:
        """Compute Precision@K, Recall@K, and AP@K for a single query."""
        recs = recommendations[:k]
        if not recs:
            return {"precision@k": 0.0, "recall@k": 0.0, "ap@k": 0.0}

        # Candidate pool relevance count for recall denominator
        q_user = query_user.lower()
        total_relevant_in_pool = sum(
            1 for u in self.df["Username"]
            if self.is_relevant(q_user, u)
        )

        hits = 0
        sum_precisions = 0.0

        for rank, rec in enumerate(recs, start=1):
            cand_user = rec["Username"]
            if self.is_relevant(q_user, cand_user):
                hits += 1
                sum_precisions += hits / rank

        precision_at_k = hits / len(recs)
        recall_at_k = (hits / total_relevant_in_pool) if total_relevant_in_pool > 0 else 0.0
        ap_at_k = (sum_precisions / hits) if hits > 0 else 0.0

        return {
            "precision@k": precision_at_k,
            "recall@k": recall_at_k,
            "ap@k": ap_at_k,
            "total_relevant_in_pool": total_relevant_in_pool,
        }

    def compute_intra_list_diversity(self, recommendations: List[Dict[str, Any]]) -> float:
        """
        Compute average pairwise Jaccard distance between recommended users' language sets.
        Higher value indicates broader, non-redundant partner variety.
        """
        if len(recommendations) < 2:
            return 0.0

        distances = []
        n = len(recommendations)
        for i in range(n):
            langs_i = parse_languages(recommendations[i].get("Languages"))
            for j in range(i + 1, n):
                langs_j = parse_languages(recommendations[j].get("Languages"))
                union = langs_i.union(langs_j)
                if union:
                    jaccard_sim = len(langs_i.intersection(langs_j)) / len(union)
                    distances.append(1.0 - jaccard_sim)
                else:
                    distances.append(0.5)

        return float(np.mean(distances)) if distances else 0.0

    def run_benchmark(
        self,
        sample_users: List[str],
        weights: Tuple[float, float, float] = (0.45, 0.35, 0.20),
        k: int = 5
    ) -> Dict[str, Any]:
        """Run evaluation benchmark across a collection of sample users."""
        precisions = []
        recalls = []
        aps = []
        diversities = []
        all_recommended_users = set()

        for user in sample_users:
            res = self.engine.recommend_hybrid(
                username=user,
                method="hdbscan",
                top_k=k,
                weights=weights
            )
            recs = res["recommendations"]
            for r in recs:
                all_recommended_users.add(r["Username"].lower())

            eval_res = self.evaluate_query(user, recs, k=k)
            precisions.append(eval_res["precision@k"])
            recalls.append(eval_res["recall@k"])
            aps.append(eval_res["ap@k"])
            diversities.append(self.compute_intra_list_diversity(recs))

        catalog_size = len(self.df)
        catalog_coverage = (len(all_recommended_users) / catalog_size) * 100.0

        return {
            "weights": {
                "content": weights[0],
                "activity_collab": weights[1],
                "bio_semantic": weights[2],
            },
            "k": k,
            "queries_evaluated": len(sample_users),
            "precision@k": float(np.mean(precisions)),
            "recall@k": float(np.mean(recalls)),
            "map@k": float(np.mean(aps)),
            "intra_list_diversity": float(np.mean(diversities)),
            "catalog_coverage_pct": float(catalog_coverage),
            "unique_recommendations": len(all_recommended_users),
        }

    def compare_weight_configurations(
        self,
        sample_users: List[str],
        k: int = 5
    ) -> pd.DataFrame:
        """
        Compare candidate hybrid weight configurations and return comparative DataFrame.
        """
        configs = [
            ("Balanced Baseline", (0.45, 0.35, 0.20)),
            ("Content Dominant", (0.60, 0.20, 0.20)),
            ("Bio-Semantic Dominant", (0.30, 0.20, 0.50)),
            ("Activity Dominant", (0.20, 0.60, 0.20)),
            ("Equal Weights", (0.333, 0.333, 0.334)),
        ]

        rows = []
        for name, weights in configs:
            bench = self.run_benchmark(sample_users, weights=weights, k=k)
            rows.append({
                "Configuration": name,
                "Content": weights[0],
                "Activity (Collab)": weights[1],
                "Bio-Semantic": weights[2],
                f"Precision@{k}": round(bench["precision@k"], 4),
                f"Recall@{k}": round(bench["recall@k"], 4),
                f"MAP@{k}": round(bench["map@k"], 4),
                "Intra-List Diversity": round(bench["intra_list_diversity"], 4),
                "Coverage (%)": round(bench["catalog_coverage_pct"], 2),
            })

        return pd.DataFrame(rows)


if __name__ == "__main__":
    engine = RecommendationEngine()
    evaluator = RecommendationEvaluator(engine)

    # Use first 50 diverse users from dataset with known languages
    valid_users = [
        u for u in engine.df["Username"].head(100)
        if len(evaluator.user_langs.get(u.lower(), set())) > 0
    ][:50]

    print(f"Running evaluation benchmark on {len(valid_users)} sample queries...")
    results_df = evaluator.compare_weight_configurations(valid_users, k=5)
    print("\n=== HYBRID WEIGHT COMPARISON EXPERIMENT RESULTS ===")
    print(results_df.to_string(index=False))
