# Import updated pandas for HDBSCAN support as well
import pandas as pd
import numpy as np
import torch
from sentence_transformers import SentenceTransformer, util
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Load hybrid recommendations (independent of clustering)
hybrid_df = pd.read_csv('data/final_hybrid_with_semantic.csv')

dbscan_df = pd.read_csv("data/dbscan_optuna_clustered_users_with_domain.csv")[["Username", "Cluster", "Domain_Tag"]]

# Load HDBSCAN clustering results (you should prepare this CSV beforehand using the HDBSCAN approach we discussed)
hdbscan_df = pd.read_csv("data/hdbscan_optuna_clustered_users_with_domain.csv")[["Username", "Cluster", "Domain_Tag"]]

# Merge DBSCAN by default
hybrid_df_dbscan = hybrid_df.merge(dbscan_df, on="Username", how="left")
hybrid_df_hdbscan = hybrid_df.merge(hdbscan_df, on="Username", how="left")

# Sentence-BERT model and embeddings (unchanged)
model = SentenceTransformer("all-MiniLM-L6-v2")
bio_embeddings = np.load("data/bio_embeddings.npy")
df_bio = pd.read_csv("data/with_bio_embeddings.csv")

@app.route('/recommend', methods=['POST'])
def recommend():
    data = request.get_json()
    username = data.get('username')
    location = data.get('location')
    domain = data.get('domain')
    method = data.get('method', 'hdbscan')

    print(f"👉 Received request | Method: {method} | Domain: {domain} | Location: {location}")

    if method == 'dbscan':
        df = hybrid_df_dbscan
    elif method == 'hdbscan':
        df = hybrid_df_hdbscan
    else:
        return jsonify({"error": "Invalid clustering method. Use 'dbscan' or 'hdbscan'."}), 400

    results = df[df['Username'] != username].copy()
    print(f"📊 After removing current user: {len(results)} users left")

    if location:
        results = results[results['Location'].str.contains(location, case=False, na=False)]
        print(f"📍 After location filter: {len(results)} users")

    if domain:
        results = results[results['Domain_Tag'] == domain]
        print(f"🏷 After domain filter: {len(results)} users")

    if results.empty:
        print("⚠️ No recommendations found after filters applied.")
        
    results = results.drop_duplicates(subset='Username')

    results = results.sort_values('hybrid_score', ascending=False).head(5)

    return jsonify(results[["Username", "Location", "Profile_URL", "Domain_Tag", "hybrid_score"]].to_dict(orient='records'))


@app.route('/semantic-bio-recommend', methods=['POST'])
def semantic_bio_recommend():
    try:
        data = request.get_json()
        input_bio = data.get("bio")

        # Embed query
        query_emb = model.encode([input_bio], convert_to_tensor=True)

        # Compare with saved embeddings
        scores = util.pytorch_cos_sim(query_emb.cpu(), torch.tensor(bio_embeddings).cpu())[0]

        # Get top results
        top_results = scores.argsort(descending=True)[1:6]
        results = df_bio.iloc[top_results.cpu()].copy()
        results["similarity"] = scores[top_results].cpu().numpy().round(4)

        return jsonify(results[["Username", "Bio", "Location", "Profile_URL", "similarity"]].to_dict(orient="records"))

    except Exception as e:
        print("❌ SERVER ERROR:", str(e))
        return jsonify({"error": "Server crashed", "details": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True)
