"""
Modernized Recommendation Engine for GitHub Project Partner Recommendation System.

Preserves and integrates original team algorithms:
- Content-Based Filtering: TF-IDF on user languages and repositories (Ekta Mulkalwar)
- Activity-Based Profile Similarity (Collaborative Filtering Proxy):
  Cosine similarity on normalized developer interactions [Public_Repos, Followers, Following] (Anand Gutte)
- Bio-Semantic Matching: Sentence-BERT bio embeddings (Apoorva Durge)
- Cluster Domain Tagging: DBSCAN and HDBSCAN clustering (Team)
"""

import logging
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import MinMaxScaler

# Locate dataset directory relative to this file
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


logger = logging.getLogger(__name__)


class BioSearchUnavailable(Exception):
    pass


class RecommendationEngine:
    def __init__(self, data_dir: Optional[Path] = None, *, model_path: Optional[str] = None):
        self.data_dir = Path(data_dir) if data_dir else DATA_DIR
        self.df: pd.DataFrame = pd.DataFrame()
        self.dbscan_df: pd.DataFrame = pd.DataFrame()
        self.hdbscan_df: pd.DataFrame = pd.DataFrame()
        self.bio_embeddings: Optional[np.ndarray] = None
        self.sbert_model: Any = None
        self.sbert_available: bool = False
        self.model_path = model_path
        self._model_attempted = False
        self._model_lock = Lock()

        # Precomputed matrices & index mappings
        self.content_matrix = None
        self.tfidf_vectorizer: Optional[TfidfVectorizer] = None
        self.collab_matrix = None
        self.scaler = MinMaxScaler()
        self.user_to_idx: Dict[str, int] = {}
        self.idx_to_user: Dict[int, str] = {}

        self._load_data()
        self._build_similarity_spaces()

    def _load_data(self) -> None:
        """Load primary user profile data, clustering tags, and embeddings with deterministic alignment."""
        users_csv = self.data_dir / "cleaned_github_users.csv"
        if not users_csv.exists():
            raise FileNotFoundError(f"Missing core user dataset: {users_csv}")

        raw_df = pd.read_csv(users_csv, dtype={"Username": "string"})
        if raw_df["Username"].isna().any() or raw_df["Username"].str.strip().eq("").any():
            raise ValueError("Core dataset contains invalid usernames.")

        # Load bio embeddings (Sentence-BERT all-MiniLM-L6-v2)
        npy_path = self.data_dir / "bio_embeddings.npy"
        raw_bio_embeddings = None
        try:
            loaded = np.load(npy_path, allow_pickle=False)
            if isinstance(loaded, np.lib.npyio.NpzFile):
                loaded.close()
            elif (
                loaded.ndim == 2
                and loaded.shape[0] == len(raw_df)
                and loaded.shape[1] > 0
                and loaded.dtype in (np.dtype("float32"), np.dtype("float64"))
                and np.isfinite(loaded).all()
            ):
                raw_bio_embeddings = loaded
            if raw_bio_embeddings is None:
                logger.warning("Bio embeddings are invalid. Using lexical bio search.")
        except (OSError, ValueError, EOFError) as error:
            logger.warning("Bio embeddings unavailable (%s). Using lexical bio search.", type(error).__name__)

        # Deduplicate while preserving 1-to-1 index alignment with bio embeddings
        is_unique = ~raw_df.duplicated(subset="Username", keep="first")
        self.df = raw_df[is_unique].reset_index(drop=True)

        if raw_bio_embeddings is not None and len(raw_bio_embeddings) == len(raw_df):
            self.bio_embeddings = raw_bio_embeddings[is_unique.values]
            # L2 normalize for fast dot-product cosine similarity
            norms = np.linalg.norm(self.bio_embeddings, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self.bio_embeddings = self.bio_embeddings / norms
        else:
            self.bio_embeddings = None

        self.user_to_idx = {user.lower(): idx for idx, user in enumerate(self.df["Username"])}
        self.idx_to_user = {idx: user for idx, user in enumerate(self.df["Username"])}

        # Load DBSCAN clusters
        dbscan_csv = self.data_dir / "dbscan_optuna_clustered_users_with_domain.csv"
        if dbscan_csv.exists():
            db_raw = pd.read_csv(dbscan_csv)[["Username", "Cluster", "Domain_Tag"]]
            self.dbscan_df = db_raw.drop_duplicates(subset="Username")
        else:
            self.dbscan_df = pd.DataFrame(columns=["Username", "Cluster", "Domain_Tag"])

        # Load HDBSCAN clusters
        hdbscan_csv = self.data_dir / "hdbscan_optuna_clustered_users_with_domain.csv"
        if hdbscan_csv.exists():
            hdb_raw = pd.read_csv(hdbscan_csv)[["Username", "Cluster", "Domain_Tag"]]
            self.hdbscan_df = hdb_raw.drop_duplicates(subset="Username")
        else:
            self.hdbscan_df = pd.DataFrame(columns=["Username", "Cluster", "Domain_Tag"])

    def _init_sbert_model(self) -> bool:
        """Load only a provisioned model or local cache. Try once per worker."""
        with self._model_lock:
            if self._model_attempted:
                return self.sbert_available
            self._model_attempted = True
            try:
                if self.model_path and not Path(self.model_path).is_dir():
                    raise FileNotFoundError("Configured local model directory is unavailable.")
                from sentence_transformers import SentenceTransformer

                self.sbert_model = SentenceTransformer(
                    self.model_path or "sentence-transformers/all-MiniLM-L6-v2",
                    local_files_only=True,
                    trust_remote_code=False,
                )
                self.sbert_available = True
            except Exception as error:
                logger.warning(
                    "Bio model unavailable (%s). Using lexical search. Provision a local model and restart.",
                    type(error).__name__,
                )
            return self.sbert_available

    def _build_similarity_spaces(self) -> None:
        """Vectorize content features and normalize interaction metrics for real-time scoring."""
        # Content feature matrix (Languages + Repositories)
        combined = (
            self.df["Languages"].fillna("").astype(str) + " " +
            self.df["Repositories"].fillna("").astype(str)
        )
        self.tfidf_vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
        self.content_matrix = self.tfidf_vectorizer.fit_transform(combined)

        # Collaborative interaction matrix (Followers, Following, Public_Repos)
        collab_cols = ["Followers", "Following", "Public_Repos"]
        interaction_raw = self.df[collab_cols].copy()
        for col in collab_cols:
            interaction_raw[col] = pd.to_numeric(interaction_raw[col], errors="coerce").fillna(0)
        self.collab_matrix = self.scaler.fit_transform(interaction_raw)
        # Normalize rows for cosine similarity
        collab_norms = np.linalg.norm(self.collab_matrix, axis=1, keepdims=True)
        collab_norms[collab_norms == 0] = 1.0
        self.collab_matrix = self.collab_matrix / collab_norms

    def get_metadata(self) -> Dict[str, Any]:
        """Return dataset stats, verified domain tags per method, and sample users."""
        dbscan_domains = sorted([
            d for d in self.dbscan_df["Domain_Tag"].dropna().unique().tolist()
            if str(d).strip()
        ])
        hdbscan_domains = sorted([
            d for d in self.hdbscan_df["Domain_Tag"].dropna().unique().tolist()
            if str(d).strip()
        ])

        # Top 10 sample users for testing
        samples = self.df["Username"].head(10).tolist()
        if "abhay" not in [s.lower() for s in samples] and "abhay" in self.user_to_idx:
            samples.insert(0, "abhay")

        return {
            "total_users": int(len(self.df)),
            "clustering_methods": {
                "hdbscan": {
                    "label": "HDBSCAN (Stable clusters)",
                    "domains": hdbscan_domains
                },
                "dbscan": {
                    "label": "DBSCAN (Granular domains)",
                    "domains": dbscan_domains
                }
            },
            "sample_usernames": samples[:10]
        }

    def recommend_hybrid(
        self,
        username: str,
        location: Optional[str] = None,
        domain: Optional[str] = None,
        method: str = "hdbscan",
        top_k: int = 5,
        weights: Tuple[float, float, float] = (0.45, 0.35, 0.20)
    ) -> Dict[str, Any]:
        """
        Dynamically calculate hybrid partner recommendations for a target user.
        Blends:
        - Content-based similarity (Languages & Repositories)
        - Activity-based profile similarity (Public_Repos, Followers, Following)
        - Bio-semantic similarity (Sentence-BERT bio embeddings)
        """
        # Validate clustering method
        method_clean = str(method).strip().lower() if method else "hdbscan"
        if method_clean not in ("dbscan", "hdbscan"):
            raise ValueError(f"Invalid clustering method: '{method}'. Must be 'dbscan' or 'hdbscan'.")

        cluster_df = self.hdbscan_df if method_clean == "hdbscan" else self.dbscan_df
        target_key = str(username).strip().lower() if username else ""
        is_known_user = target_key in self.user_to_idx

        # Sanitize and bound top_k
        try:
            k = max(1, min(50, int(top_k)))
        except (ValueError, TypeError):
            k = 5

        # Attach domain tags to candidate profiles
        candidates = self.df.copy()
        if not cluster_df.empty:
            candidates = candidates.merge(cluster_df[["Username", "Domain_Tag"]], on="Username", how="left")
        else:
            candidates["Domain_Tag"] = "General"

        n_users = len(self.df)

        if is_known_user:
            target_idx = self.user_to_idx[target_key]
            target_user_row = self.df.iloc[target_idx]

            # 1. Content similarity (cosine)
            target_content_vec = self.content_matrix[target_idx]
            content_sim = cosine_similarity(target_content_vec, self.content_matrix)[0]

            # 2. Collaborative / activity similarity (cosine)
            target_collab_vec = self.collab_matrix[target_idx]
            collab_sim = np.dot(self.collab_matrix, target_collab_vec)

            # 3. Bio semantic similarity
            if self.bio_embeddings is not None and target_idx < len(self.bio_embeddings):
                target_bio_vec = self.bio_embeddings[target_idx]
                bio_sim = np.dot(self.bio_embeddings, target_bio_vec)
            else:
                bio_sim = np.zeros(n_users)

            w_content, w_collab, w_bio = weights
            hybrid_score = (w_content * content_sim) + (w_collab * collab_sim) + (w_bio * bio_sim)

            candidates["content_score"] = np.clip(content_sim, 0.0, 1.0).round(4)
            candidates["collab_score"] = np.clip(collab_sim, 0.0, 1.0).round(4)
            candidates["bio_score"] = np.clip(bio_sim, 0.0, 1.0).round(4)
            candidates["hybrid_score"] = np.clip(hybrid_score, 0.0, 1.0).round(4)

            # Exclude self
            candidates = candidates[candidates.index != target_idx].copy()
            target_langs = set(
                l.strip().lower()
                for l in str(target_user_row.get("Languages", "")).split(",")
                if l.strip() and l.strip().lower() != "unknown"
            )
        else:
            # Cold-start fallback: user not in dataset
            candidates["content_score"] = 0.50
            candidates["collab_score"] = 0.50
            candidates["bio_score"] = 0.50
            # Rank candidates by balanced interaction activity
            candidates["hybrid_score"] = (
                pd.to_numeric(candidates["Followers"], errors="coerce").fillna(0) * 0.5 +
                pd.to_numeric(candidates["Public_Repos"], errors="coerce").fillna(0) * 0.5
            ).round(4)
            target_langs = set()

        # Apply Literal Location Filter (regex=False prevents regex crash on special characters)
        if location and str(location).strip():
            loc_query = str(location).strip()
            candidates = candidates[
                candidates["Location"].astype(str).str.contains(loc_query, case=False, na=False, regex=False)
            ]

        # Apply Domain Filter
        if domain and str(domain).strip() and str(domain).strip().lower() != "all":
            dom_query = str(domain).strip()
            candidates = candidates[candidates["Domain_Tag"] == dom_query]

        # Sort and select top K
        results_df = candidates.sort_values(by="hybrid_score", ascending=False).head(k)

        # Format output records with contextual explanations
        recommendations = []
        for _, row in results_df.iterrows():
            cand_langs = [
                l.strip()
                for l in str(row.get("Languages", "")).split(",")
                if l.strip() and l.strip().lower() != "unknown"
            ]
            overlap = [l for l in cand_langs if l.lower() in target_langs]

            if is_known_user:
                if overlap:
                    explanation = f"Shared languages: {', '.join(overlap[:3])}. High interaction similarity."
                else:
                    explanation = f"Matched across {row.get('Domain_Tag', 'technical')} projects and profile metrics."
            else:
                explanation = "Cold-start recommendation: High activity and domain relevance."

            rec = {
                "Username": str(row["Username"]),
                "Name": str(row.get("Name", "")),
                "Location": str(row.get("Location", "Location unspecified")),
                "Profile_URL": str(row.get("Profile_URL", f"https://github.com/{row['Username']}")),
                "Domain_Tag": str(row.get("Domain_Tag", "General")),
                "Languages": cand_langs[:5],
                "hybrid_score": float(row["hybrid_score"]),
                "content_score": float(row.get("content_score", 0.0)),
                "collab_score": float(row.get("collab_score", 0.0)),
                "bio_score": float(row.get("bio_score", 0.0)),
                "explanation": explanation,
            }
            recommendations.append(rec)

        return {
            "query_user": username,
            "is_known_user": is_known_user,
            "method": method_clean,
            "count": len(recommendations),
            "recommendations": recommendations,
        }

    def recommend_by_bio(self, bio_query: str, top_k: int = 5) -> Dict[str, Any]:
        """
        Free-text semantic partner search based on project interests or bio.
        Calculates cosine similarity with Sentence-BERT embeddings.
        """
        if not bio_query or not str(bio_query).strip():
            return {"query": "", "count": 0, "recommendations": []}

        # Truncate free-text query to avoid DOS or memory spikes
        query_text = str(bio_query).strip()[:1000]

        # Sanitize and bound top_k
        try:
            k = max(1, min(50, int(top_k)))
        except (ValueError, TypeError):
            k = 5

        n_users = len(self.df)
        scores = np.zeros(n_users)
        used_sbert = False

        if self.bio_embeddings is not None and self._init_sbert_model():
            try:
                query_vec = self.sbert_model.encode([query_text], convert_to_numpy=True)
                q_norm = np.linalg.norm(query_vec)
                if q_norm > 0:
                    query_vec = query_vec / q_norm
                if query_vec.shape != (1, self.bio_embeddings.shape[1]) or not np.isfinite(query_vec).all():
                    raise ValueError("Model and embedding artifact are incompatible.")
                scores = np.dot(self.bio_embeddings, query_vec[0])
                used_sbert = True
            except Exception as error:
                logger.warning("Bio inference unavailable (%s). Using lexical search.", type(error).__name__)

        if not used_sbert:
            # Fallback: TF-IDF on user bios
            bio_texts = self.df["Bio"].fillna("").tolist() if "Bio" in self.df else []
            bio_vectorizer = TfidfVectorizer(stop_words="english")
            try:
                bio_matrix = bio_vectorizer.fit_transform(bio_texts)
            except ValueError as error:
                logger.warning("Lexical bio search unavailable (%s).", type(error).__name__)
                raise BioSearchUnavailable from None
            query_vec = bio_vectorizer.transform([query_text])
            scores = cosine_similarity(query_vec, bio_matrix)[0]

        # Top k matches (including index 0, since query is arbitrary text!)
        top_indices = np.argsort(scores)[::-1][:k]

        recommendations = []
        for idx in top_indices:
            row = self.df.iloc[idx]
            sim = float(np.clip(scores[idx], 0.0, 1.0).round(4))
            recommendations.append({
                "Username": str(row["Username"]),
                "Name": str(row.get("Name", "")),
                "Bio": str(row.get("Bio", "No bio provided")),
                "Location": str(row.get("Location", "Location unspecified")),
                "Profile_URL": str(row.get("Profile_URL", f"https://github.com/{row['Username']}")),
                "similarity": sim,
            })

        return {
            "query": query_text,
            "engine": "Sentence-BERT (all-MiniLM-L6-v2)" if used_sbert else "TF-IDF Fallback",
            "count": len(recommendations),
            "recommendations": recommendations,
        }
