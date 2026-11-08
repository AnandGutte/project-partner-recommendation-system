import React, { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "http://127.0.0.1:5000";

function Recommendation() {
  const [username, setUsername] = useState("");
  const [location, setLocation] = useState("");
  const [domain, setDomain] = useState("");
  const [bio, setBio] = useState("");
  const [clusteringMethod, setClusteringMethod] = useState("hdbscan");
  const [results, setResults] = useState([]);
  const [bioResults, setBioResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [metadata, setMetadata] = useState(null);

  // Fallback domain options matching verified dataset clusters
  const defaultDomains = {
    hdbscan: [
      "DevOps & Scripting",
      "Testing & Sparse Data",
      "Unknown Users",
    ],
    dbscan: [
      "Blockchain & Ripple Projects",
      "DevOps & Scripting",
      "Game & Modding",
      "MERN & Node.js Dev",
      "Misc / Other",
      "Ruby & Web Dev",
      "Testing & Beginners",
      "Unknown / Sparse Users",
    ],
  };

  // Fetch verified domain options from backend metadata endpoint on mount
  useEffect(() => {
    let isMounted = true;
    if (axios && typeof axios.get === "function") {
      try {
        const req = axios.get(`${API_BASE}/api/metadata`);
        if (req && typeof req.then === "function") {
          req
            .then((res) => {
              if (isMounted && res && res.data && res.data.clustering_methods) {
                setMetadata(res.data);
              }
            })
            .catch(() => {
              // Graceful fallback to verified defaults if metadata endpoint is unreachable
            });
        }
      } catch (e) {
        // Safe fallback
      }
    }
    return () => {
      isMounted = false;
    };
  }, []);

  const domainOptions =
    metadata?.clustering_methods?.[clusteringMethod]?.domains ||
    defaultDomains[clusteringMethod] ||
    [];

  const getRecommendations = async () => {
    setLoading(true);
    setError("");
    setResults([]);

    try {
      const response = await axios.post(`${API_BASE}/recommend`, {
        username: username.trim(),
        location: location.trim(),
        domain: domain === "All" ? "" : domain,
        method: clusteringMethod,
      });
      setResults(response.data || []);
    } catch {
      setError("⚠️ Failed to fetch partner recommendations.");
    } finally {
      setLoading(false);
    }
  };

  const getBioRecommendations = async () => {
    setLoading(true);
    setError("");
    setBioResults([]);

    try {
      const response = await axios.post(`${API_BASE}/semantic-bio-recommend`, {
        bio: bio.trim(),
      });
      setBioResults(response.data || []);
    } catch {
      setError("⚠️ Failed to fetch bio-based recommendations.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h2>🤝 GitHub Project Partner Recommendation</h2>
        <p className="subtitle">
          Find ideal technical collaborators through content matching, activity patterns, and bio semantics.
        </p>
      </header>

      {/* Main Filter Section */}
      <section className="section-box" aria-labelledby="partner-search-heading">
        <h3 id="partner-search-heading" className="section-title">
          🔍 Hybrid Partner Matching
        </h3>

        <div className="input-group">
          <label htmlFor="github-username">GitHub Username (Target Developer)</label>
          <input
            id="github-username"
            type="text"
            placeholder="GitHub Username (e.g. abhay, mojombo)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="input-row">
          <div className="input-group">
            <label htmlFor="preferred-location">Preferred Location</label>
            <input
              id="preferred-location"
              type="text"
              placeholder="Preferred Location (Optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="input-group">
            <label htmlFor="cluster-method">Clustering Strategy</label>
            <select
              id="cluster-method"
              value={clusteringMethod}
              onChange={(e) => {
                setClusteringMethod(e.target.value);
                setDomain("");
              }}
              disabled={loading}
            >
              <option value="hdbscan">HDBSCAN (3 Stable Clusters)</option>
              <option value="dbscan">DBSCAN (8 Granular Domains)</option>
            </select>
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="domain-filter">Domain Specialization</label>
          <select
            id="domain-filter"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={loading}
          >
            <option value="">Any Domain</option>
            {domainOptions.map((d, i) => (
              <option key={i} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn-primary"
          onClick={getRecommendations}
          disabled={loading || !username.trim()}
          aria-busy={loading}
        >
          {loading ? "Analyzing developer profiles..." : "Get Partner Matches"}
        </button>
      </section>

      {/* Semantic Bio Search Section */}
      <section className="section-box" aria-labelledby="bio-search-heading">
        <h3 id="bio-search-heading" className="section-title">
          🧠 Semantic Bio Search
        </h3>
        <p className="section-help">
          Describe the kind of partner, stack, or project you want to build in plain English.
        </p>

        <div className="input-group">
          <label htmlFor="bio-input">Developer Bio / Project Concept</label>
          <input
            id="bio-input"
            type="text"
            placeholder="Enter Bio to Get Semantic Matches"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            disabled={loading}
          />
        </div>

        <button
          className="btn-secondary"
          onClick={getBioRecommendations}
          disabled={loading || !bio.trim()}
          aria-busy={loading}
        >
          {loading ? "Searching embeddings..." : "Get Bio Matches"}
        </button>
      </section>

      {/* Error Message */}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {/* Hybrid Partner Results */}
      {results.length > 0 && (
        <section className="results-box" aria-live="polite">
          <h3>
            🎯 Top Hybrid Matches ({clusteringMethod.toUpperCase()} Mode)
          </h3>
          <div className="card-container">
            {results.map((r, i) => (
              <article className="card" key={i}>
                <div className="card-header">
                  <h4>{r.Username}</h4>
                  <span className="score-badge">
                    Match: {(r.hybrid_score * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="score-chips">
                  <span className="chip chip-score">Score: {r.hybrid_score?.toFixed(2)}</span>
                  {r.Domain_Tag && <span className="chip chip-domain">Domain: {r.Domain_Tag}</span>}
                  {r.Location && <span className="chip chip-loc">📍 {r.Location}</span>}
                </div>

                {r.explanation && (
                  <p className="card-explanation">
                    💡 <strong>Match Reason:</strong> {r.explanation}
                  </p>
                )}

                {r.Languages && r.Languages.length > 0 && (
                  <div className="languages-box">
                    <span className="languages-label">Top Tech:</span>
                    <div className="tag-list">
                      {r.Languages.slice(0, 4).map((lang, li) => (
                        <span key={li} className="lang-tag">
                          {lang}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {r.Profile_URL && (
                  <div className="card-footer">
                    <a
                      href={r.Profile_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="profile-link"
                    >
                      View GitHub Profile ↗
                    </a>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Semantic Bio Results */}
      {bioResults.length > 0 && (
        <section className="results-box" aria-live="polite">
          <h3>🧠 Semantic Bio Recommendations</h3>
          <div className="card-container">
            {bioResults.map((r, i) => (
              <article className="card" key={i}>
                <div className="card-header">
                  <h4>{r.Username}</h4>
                  <span className="score-badge">
                    Similarity: {(r.similarity * 100).toFixed(0)}%
                  </span>
                </div>

                {r.Bio && (
                  <p className="card-bio">
                    <em>"{r.Bio}"</em>
                  </p>
                )}

                <div className="score-chips">
                  <span className="chip chip-score">Similarity: {r.similarity.toFixed(2)}</span>
                  {r.Location && <span className="chip chip-loc">📍 {r.Location}</span>}
                </div>

                {r.Profile_URL && (
                  <div className="card-footer">
                    <a
                      href={r.Profile_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="profile-link"
                    >
                      View GitHub Profile ↗
                    </a>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default Recommendation;
