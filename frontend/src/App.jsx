import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

const DEFAULT_DOMAINS = {
  hdbscan: ["DevOps & Scripting", "Testing & Sparse Data", "Unknown Users"],
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

const SAMPLE_PROMPTS = [
  "Looking for a Python developer experienced with PyTorch, NLP, and recommendation systems.",
  "Full-stack web engineer building open-source React, Node.js, and TypeScript developer tools.",
  "DevOps and systems programmer working with Go, Docker, Kubernetes, and Linux automation.",
  "Game developer and modder with C++, Rust, and graphics pipeline experience.",
];

function App() {
  const [activeTab, setActiveTab] = useState("hybrid"); // "hybrid" | "bio"
  const [username, setUsername] = useState("");
  const [location, setLocation] = useState("");
  const [domain, setDomain] = useState("");
  const [clusteringMethod, setClusteringMethod] = useState("hdbscan");
  const [topK, setTopK] = useState(5);
  const [bioQuery, setBioQuery] = useState("");

  const [validationError, setValidationError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking"); // "online" | "offline" | "checking"
  const [activeEngine, setActiveEngine] = useState(null);
  const [showAboutModal, setShowAboutModal] = useState(false);

  const [hybridResults, setHybridResults] = useState(null);
  const [bioResults, setBioResults] = useState(null);
  const [lastQuery, setLastQuery] = useState(null);

  const resultsRef = useRef(null);
  const aboutDialogRef = useRef(null);

  // Load verified metadata on mount
  useEffect(() => {
    let isMounted = true;
    if (axios && typeof axios.get === "function") {
      try {
        const req = axios.get(`${API_BASE}/api/metadata`);
        if (req && typeof req.then === "function") {
          req
            .then((res) => {
              if (isMounted && res && res.data) {
                setMetadata(res.data);
                setApiStatus("online");
              }
            })
            .catch(() => {
              if (isMounted) {
                setApiStatus("offline");
              }
            });
        }
      } catch {
        if (isMounted) {
          setApiStatus("offline");
        }
      }
    }
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle ESC key for modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && showAboutModal) {
        setShowAboutModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showAboutModal]);

  const domainOptions =
    metadata?.clustering_methods?.[clusteringMethod]?.domains ||
    DEFAULT_DOMAINS[clusteringMethod] ||
    [];

  // Client-side username validation
  const validateUsername = (val) => {
    const trimmed = val.trim();
    if (!trimmed) {
      return "GitHub username is required.";
    }
    if (trimmed.length > 39) {
      return "GitHub username cannot exceed 39 characters.";
    }
    return "";
  };

  // Client-side bio query validation
  const validateBio = (val) => {
    const trimmed = val.trim();
    if (!trimmed) {
      return "Search description or project concept is required.";
    }
    if (trimmed.length > 1000) {
      return "Search query cannot exceed 1,000 characters.";
    }
    return "";
  };

  const handleHybridSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const valErr = validateUsername(username);
    if (valErr) {
      setValidationError(valErr);
      return;
    }
    setValidationError("");
    setError(null);
    setLoading(true);
    setHybridResults(null);

    const payload = {
      username: username.trim(),
      location: location.trim(),
      domain: domain === "All" ? "" : domain,
      method: clusteringMethod,
      top_k: Number(topK) || 5,
    };

    try {
      let response;
      try {
        response = await axios.post(`${API_BASE}/api/recommend`, payload);
      } catch (apiErr) {
        if (apiErr.response && apiErr.response.status === 404) {
          response = await axios.post(`${API_BASE}/recommend`, payload);
        } else {
          throw apiErr;
        }
      }

      const data = response.data;
      let records = [];
      let isKnown = true;
      let queryUser = username.trim();

      if (Array.isArray(data)) {
        records = data;
      } else if (data && Array.isArray(data.recommendations)) {
        records = data.recommendations;
        isKnown = data.is_known_user !== false;
        queryUser = data.query_user || queryUser;
      }

      setHybridResults(records);
      setLastQuery({
        type: "hybrid",
        user: queryUser,
        isKnown,
        method: clusteringMethod,
        count: records.length,
      });

      setTimeout(() => {
        if (resultsRef.current) {
          resultsRef.current.focus();
        }
      }, 100);
    } catch (err) {
      const serverMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Unable to fetch partner recommendations. Please check that the backend server is running.";
      setError({
        type: "network",
        message: serverMsg,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBioSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const valErr = validateBio(bioQuery);
    if (valErr) {
      setValidationError(valErr);
      return;
    }
    setValidationError("");
    setError(null);
    setLoading(true);
    setBioResults(null);

    const payload = {
      bio: bioQuery.trim(),
      top_k: Number(topK) || 5,
    };

    try {
      let response;
      try {
        response = await axios.post(`${API_BASE}/api/semantic-bio-recommend`, payload);
      } catch (apiErr) {
        if (apiErr.response && apiErr.response.status === 404) {
          response = await axios.post(`${API_BASE}/semantic-bio-recommend`, payload);
        } else {
          throw apiErr;
        }
      }

      const data = response.data;
      let records = [];
      let engineName = "TF-IDF Fallback";

      if (Array.isArray(data)) {
        records = data;
      } else if (data && Array.isArray(data.recommendations)) {
        records = data.recommendations;
        engineName = data.engine || engineName;
      }

      setActiveEngine(engineName);
      setBioResults(records);
      setLastQuery({
        type: "bio",
        query: bioQuery.trim(),
        engine: engineName,
        count: records.length,
      });

      setTimeout(() => {
        if (resultsRef.current) {
          resultsRef.current.focus();
        }
      }, 100);
    } catch (err) {
      const serverMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Unable to fetch semantic bio recommendations. Please ensure backend service is available.";
      setError({
        type: "network",
        message: serverMsg,
      });
    } finally {
      setLoading(false);
    }
  };

  const resetFilters = useCallback(() => {
    setUsername("");
    setLocation("");
    setDomain("");
    setBioQuery("");
    setTopK(5);
    setValidationError("");
    setError(null);
    setHybridResults(null);
    setBioResults(null);
    setLastQuery(null);
  }, []);

  return (
    <div className="app-wrapper">
      {/* WCAG 2.4.1 Skip Link */}
      <a href="#main-content" className="skip-link">
        Skip to main search content
      </a>

      {/* Top Application Header */}
      <header className="app-header" role="banner">
        <div className="header-container">
          <div className="header-brand">
            <div className="brand-logo" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                <path d="M6 9v12" />
              </svg>
            </div>
            <div className="brand-info">
              <span className="brand-name">Project Partner</span>
              <span className="brand-sub">GitHub Developer Matching</span>
            </div>
          </div>

          <div className="header-controls">
            {/* Live API Health Status */}
            <div
              className={`api-status-badge status-${apiStatus}`}
              title={
                apiStatus === "online"
                  ? "Connected to Flask Backend API (Port 5000)"
                  : apiStatus === "checking"
                  ? "Connecting to API..."
                  : "API Offline or Unreachable"
              }
              role="status"
              aria-label={`API Status: ${apiStatus}`}
            >
              <span className="status-dot" aria-hidden="true" />
              <span className="status-text">
                {apiStatus === "online" ? "API Online" : apiStatus === "checking" ? "Checking API..." : "API Offline"}
              </span>
            </div>

            {/* About Modal Trigger */}
            <button
              type="button"
              className="btn-header-link"
              onClick={() => setShowAboutModal(true)}
              aria-haspopup="dialog"
            >
              About & Team
            </button>

            {/* Verified GitHub Repository Link */}
            <a
              href="https://github.com/AnandGutte/project-partner-recommendation-system"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-header-repo"
              aria-label="View Project Partner repository on GitHub in new tab"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              <span>GitHub ↗</span>
            </a>
          </div>
        </div>
      </header>

      {/* Hero Showcase Section */}
      <section className="hero-section" aria-label="Introduction">
        <div className="hero-container">
          <div className="hero-badge">CS 5661 Data Science Portfolio Showcase</div>
          <h1 className="header-title">🤝 GitHub Project Partner Recommendation</h1>
          <p className="hero-headline">Find your next great collaborator.</p>
          <p className="header-subtitle">
            Discover software collaborators based on language repositories, developer activity metrics, and bio semantics.
          </p>

          {/* Verified Product & Engine Metrics */}
          <div className="metric-grid" aria-label="Verified Platform Metrics">
            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-icon" aria-hidden="true">📊</span>
                <span className="metric-label">Dataset Profiles</span>
              </div>
              <div className="metric-value">
                {metadata?.total_users ? metadata.total_users.toLocaleString() : "3,890"}
              </div>
              <div className="metric-desc">
                {metadata?.total_users ? `${metadata.total_users.toLocaleString()} Aligned Developer Profiles` : "3,890 Aligned Developer Profiles"}
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-icon" aria-hidden="true">⚖️</span>
                <span className="metric-label">Hybrid Strategy</span>
              </div>
              <div className="metric-value">3-Way Heuristic</div>
              <div className="metric-desc">Content 45% • Activity 35% • Bio 20%</div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-icon" aria-hidden="true">🏷️</span>
                <span className="metric-label">Clustering Domains</span>
              </div>
              <div className="metric-value">11 Categories</div>
              <div className="metric-desc">HDBSCAN (3) & DBSCAN (8) Models</div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-icon" aria-hidden="true">🧠</span>
                <span className="metric-label">Active Engine</span>
              </div>
              <div className="metric-value">
                {activeEngine ? (activeEngine.includes("Sentence-BERT") ? "Sentence-BERT" : "TF-IDF Fallback") : "Sentence-BERT / TF-IDF"}
              </div>
              <div className="metric-desc">
                {activeEngine ? activeEngine : "Vector Space & Lexical Models"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <main id="main-content" className="main-content" tabIndex="-1">
        {/* Navigation Tabs for Search Modes */}
        <div
          className="tab-nav"
          role="tablist"
          aria-label="Recommendation Search Strategy"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const nextTab = activeTab === "hybrid" ? "bio" : "hybrid";
              setActiveTab(nextTab);
              setValidationError("");
              document.getElementById(`tab-${nextTab}`)?.focus();
            }
          }}
        >
          <button
            role="tab"
            id="tab-hybrid"
            tabIndex={activeTab === "hybrid" ? 0 : -1}
            aria-selected={activeTab === "hybrid"}
            aria-controls="panel-hybrid"
            className={`tab-btn ${activeTab === "hybrid" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("hybrid");
              setValidationError("");
            }}
          >
            🔍 Hybrid Partner Match
          </button>
          <button
            role="tab"
            id="tab-bio"
            tabIndex={activeTab === "bio" ? 0 : -1}
            aria-selected={activeTab === "bio"}
            aria-controls="panel-bio"
            className={`tab-btn ${activeTab === "bio" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("bio");
              setValidationError("");
            }}
          >
            🧠 Semantic Concept Search
          </button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="alert-banner alert-error" role="alert" aria-live="assertive">
            <div className="alert-content">
              <span className="alert-icon" aria-hidden="true">⚠️</span>
              <div className="alert-text">
                <strong>Request Failed:</strong> {error.message}
              </div>
            </div>
            <button
              type="button"
              className="alert-dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss alert"
            >
              ✕
            </button>
          </div>
        )}

        {/* Inline Form Validation Error */}
        {validationError && (
          <div id="validation-error-msg" className="alert-banner alert-warning" role="alert" aria-live="assertive">
            <span className="alert-icon" aria-hidden="true">ℹ️</span>
            <div className="alert-text">{validationError}</div>
          </div>
        )}

        {/* TAB 1: Hybrid Partner Matching Panel */}
        {activeTab === "hybrid" && (
          <section
            id="panel-hybrid"
            role="tabpanel"
            aria-labelledby="tab-hybrid"
            className="search-panel"
          >
            <form onSubmit={handleHybridSubmit} noValidate>
              <div className="panel-intro">
                <h2 className="panel-heading">Target Developer & Partner Criteria</h2>
                <p className="panel-desc">
                  Input a GitHub username to compute real-time similarities across repository languages, developer activity metrics, and bio vectors.
                </p>
              </div>

              {/* Sample User Quick-Picks */}
              {metadata?.sample_usernames && metadata.sample_usernames.length > 0 && (
                <div className="sample-users-box">
                  <span className="sample-label">Try sample profile:</span>
                  <div className="sample-pills">
                    {metadata.sample_usernames.slice(0, 6).map((u) => (
                      <button
                        key={u}
                        type="button"
                        className="sample-btn"
                        onClick={() => {
                          setUsername(u);
                          setValidationError("");
                        }}
                      >
                        @{u}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-grid">
                {/* Primary Dominant Username Field */}
                <div className="form-group full-width">
                  <label htmlFor="input-username" className="form-label required">
                    GitHub Username <span className="visually-hidden">(required)</span>
                  </label>
                  <div className="input-with-icon">
                    <span className="input-prefix" aria-hidden="true">@</span>
                    <input
                      id="input-username"
                      type="text"
                      className="form-control"
                      placeholder="e.g. abhay, mojombo, defunkt"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        if (validationError) setValidationError("");
                      }}
                      maxLength={39}
                      disabled={loading}
                      aria-required="true"
                      aria-invalid={activeTab === "hybrid" && !!validationError}
                      aria-describedby={
                        activeTab === "hybrid" && validationError
                          ? "validation-error-msg username-hint"
                          : "username-hint"
                      }
                    />
                  </div>
                  <span id="username-hint" className="form-hint">
                    Target user against which candidate similarities will be calculated.
                  </span>
                </div>

                {/* Filter Controls */}
                <div className="form-group">
                  <label htmlFor="input-location" className="form-label">
                    Preferred Location (Optional)
                  </label>
                  <input
                    id="input-location"
                    type="text"
                    className="form-control"
                    placeholder="e.g. San Francisco, India, Remote"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    disabled={loading}
                    aria-describedby="location-hint"
                  />
                  <span id="location-hint" className="form-hint">
                    Filters candidates by literal location match.
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="select-clustering" className="form-label">
                    Clustering Algorithm
                  </label>
                  <select
                    id="select-clustering"
                    className="form-control"
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

                <div className="form-group">
                  <label htmlFor="select-domain" className="form-label">
                    Domain Specialization
                  </label>
                  <select
                    id="select-domain"
                    className="form-control"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Any Domain (All Clusters)</option>
                    {domainOptions.map((d, i) => (
                      <option key={i} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="select-topk" className="form-label">
                    Results to Display
                  </label>
                  <select
                    id="select-topk"
                    className="form-control"
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    disabled={loading}
                  >
                    <option value={3}>Top 3 Candidates</option>
                    <option value={5}>Top 5 Candidates</option>
                    <option value={10}>Top 10 Candidates</option>
                  </select>
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                  aria-busy={loading}
                >
                  {loading ? (
                    <span className="spinner-text">
                      <span className="spinner" aria-hidden="true" /> Analyzing Candidate Space...
                    </span>
                  ) : (
                    "Find Project Partners"
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={resetFilters}
                  disabled={loading}
                >
                  Reset Form
                </button>
              </div>
            </form>
          </section>
        )}

        {/* TAB 2: Semantic Concept Search Panel */}
        {activeTab === "bio" && (
          <section
            id="panel-bio"
            role="tabpanel"
            aria-labelledby="tab-bio"
            className="search-panel"
          >
            <form onSubmit={handleBioSubmit} noValidate>
              <div className="panel-intro">
                <div className="panel-intro-header">
                  <h2 className="panel-heading">Semantic Bio & Project Concept Match</h2>
                  <span className="engine-indicator-pill" title="Current backend search engine">
                    Active Engine: {activeEngine || "Sentence-BERT / TF-IDF"}
                  </span>
                </div>
                <p className="panel-desc">
                  Describe what you want to build or the technical background you are looking for. Vector embeddings or lexical models identify matching developers.
                </p>
              </div>

              {/* Quick Inspiration Prompts */}
              <div className="sample-prompts-box">
                <span className="sample-label">Example queries:</span>
                <div className="sample-prompt-chips">
                  {SAMPLE_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="prompt-chip"
                      onClick={() => {
                        setBioQuery(prompt);
                        if (validationError) setValidationError("");
                      }}
                    >
                      {prompt.slice(0, 48)}...
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group full-width">
                <label htmlFor="input-bio" className="form-label required">
                  Project Concept or Ideal Partner Description <span className="visually-hidden">(required)</span>
                </label>
                <textarea
                  id="input-bio"
                  className="form-control textarea"
                  rows="4"
                  placeholder="e.g. Looking for a Python machine learning collaborator with experience in NLP, PyTorch, and recommendation algorithms..."
                  value={bioQuery}
                  onChange={(e) => {
                    setBioQuery(e.target.value);
                    if (validationError) setValidationError("");
                  }}
                  maxLength={1000}
                  disabled={loading}
                  aria-required="true"
                  aria-invalid={activeTab === "bio" && !!validationError}
                  aria-describedby={
                    activeTab === "bio" && validationError
                      ? "validation-error-msg bio-hint"
                      : "bio-hint"
                  }
                />
                <div className="textarea-footer">
                  <span id="bio-hint" className="form-hint">
                    {activeEngine?.includes("Sentence-BERT")
                      ? "Sentence-BERT model computes cosine distance against candidate bio embeddings."
                      : "Lexical TF-IDF representations compute similarity against candidate profile text."}
                  </span>
                  <span className="char-counter" aria-live="polite">
                    {bioQuery.length} / 1,000
                  </span>
                </div>
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="select-bio-topk" className="form-label">
                    Results to Display
                  </label>
                  <select
                    id="select-bio-topk"
                    className="form-control"
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    disabled={loading}
                  >
                    <option value={3}>Top 3 Candidates</option>
                    <option value={5}>Top 5 Candidates</option>
                    <option value={10}>Top 10 Candidates</option>
                  </select>
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled={loading}
                  aria-busy={loading}
                >
                  {loading ? (
                    <span className="spinner-text">
                      <span className="spinner" aria-hidden="true" /> Searching Candidate Space...
                    </span>
                  ) : (
                    "Search Semantic Matches"
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={resetFilters}
                  disabled={loading}
                >
                  Reset Form
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Live Loading Announcement (WCAG 4.1.3) */}
        {loading && (
          <div className="loading-state" role="status" aria-live="polite">
            <div className="spinner large" aria-hidden="true" />
            <p className="loading-text">
              Scoring developer profiles using hybrid feature spaces (Content 45%, Activity 35%, Bio 20%)...
            </p>
          </div>
        )}

        {/* RESULTS SECTION */}
        <section
          ref={resultsRef}
          tabIndex="-1"
          className="results-container"
          aria-label="Recommendation Search Results"
        >
          {/* Hybrid Results */}
          {activeTab === "hybrid" && hybridResults !== null && (
            <div className="results-wrapper">
              <div className="results-header">
                <div>
                  <h2 className="results-title">
                    🎯 Recommended Partners ({lastQuery?.method?.toUpperCase() || "HDBSCAN"} Mode)
                  </h2>
                  <p className="results-meta">
                    Target: <strong>@{lastQuery?.user}</strong> • Retrieved{" "}
                    <strong>{hybridResults.length}</strong> candidate profile{hybridResults.length !== 1 ? "s" : ""}
                    {lastQuery?.isKnown === false && (
                      <span className="cold-start-badge" title="Query user was not found in dataset; ranked by domain activity">
                        Cold-Start Baseline
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Score Explanation Disclaimer (Requirement 4 & 6) */}
              <div className="score-disclaimer" role="note">
                <span className="disclaimer-icon" aria-hidden="true">💡</span>
                <p>
                  <strong>About Recommendation Scores:</strong> Scores reflect heuristic feature similarity computed across repository languages (45%), activity metrics (35%), and profile semantics (20%). They represent dataset portfolio alignment, not a scientifically validated personal compatibility guarantee.
                </p>
              </div>

              {hybridResults.length === 0 ? (
                <div className="empty-state" role="status">
                  <div className="empty-icon" aria-hidden="true">🔍</div>
                  <h3>No Matching Developer Profiles Found</h3>
                  <p>
                    No candidates matched all of your filter criteria. Try selecting <strong>Any Domain</strong> or clearing the location filter to broaden candidate eligibility.
                  </p>
                  <button type="button" className="btn btn-outline" onClick={resetFilters}>
                    Clear Filters & Reset
                  </button>
                </div>
              ) : (
                <div className="card-grid">
                  {hybridResults.map((r, i) => (
                    <article className="candidate-card" key={r.Username || i} aria-labelledby={`cand-${i}-name`}>
                      <div className="card-top">
                        <div className="cand-info">
                          <div className="cand-avatar" aria-hidden="true">
                            {(r.Username || "U").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 id={`cand-${i}-name`} className="cand-username">
                              @{r.Username}
                            </h3>
                            {r.Location && <span className="cand-loc">📍 {r.Location}</span>}
                          </div>
                        </div>
                        <div className="score-chip" title="Heuristic hybrid ranking score in [0.0, 1.0]">
                          <span className="score-label">Portfolio Match</span>
                          <span className="score-val">
                            {r.hybrid_score != null ? `${(r.hybrid_score * 100).toFixed(0)}%` : "N/A"}
                          </span>
                        </div>
                      </div>

                      {/* Component Score Breakdown */}
                      {(r.content_score != null || r.collab_score != null || r.bio_score != null) && (
                        <div className="score-breakdown">
                          <div className="breakdown-item" title="Language & Repo portfolio overlap (45% weight)">
                            <div className="breakdown-label-row">
                              <span className="breakdown-tag">Content: {(r.content_score * 100).toFixed(0)}%</span>
                              <span className="breakdown-weight">45% weight</span>
                            </div>
                            <div className="breakdown-meter-bg" aria-hidden="true">
                              <div
                                className="breakdown-meter-fill fill-content"
                                style={{ width: `${Math.min(100, Math.max(0, r.content_score * 100))}%` }}
                              />
                            </div>
                          </div>

                          <div className="breakdown-item" title="Developer engagement scale similarity (35% weight)">
                            <div className="breakdown-label-row">
                              <span className="breakdown-tag">Activity: {(r.collab_score * 100).toFixed(0)}%</span>
                              <span className="breakdown-weight">35% weight</span>
                            </div>
                            <div className="breakdown-meter-bg" aria-hidden="true">
                              <div
                                className="breakdown-meter-fill fill-activity"
                                style={{ width: `${Math.min(100, Math.max(0, r.collab_score * 100))}%` }}
                              />
                            </div>
                          </div>

                          <div className="breakdown-item" title="Bio semantic embedding similarity (20% weight)">
                            <div className="breakdown-label-row">
                              <span className="breakdown-tag">Bio: {(r.bio_score * 100).toFixed(0)}%</span>
                              <span className="breakdown-weight">20% weight</span>
                            </div>
                            <div className="breakdown-meter-bg" aria-hidden="true">
                              <div
                                className="breakdown-meter-fill fill-bio"
                                style={{ width: `${Math.min(100, Math.max(0, r.bio_score * 100))}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {r.Domain_Tag && (
                        <div className="domain-row">
                          <span className="domain-badge">Domain: {r.Domain_Tag}</span>
                        </div>
                      )}

                      {r.explanation && (
                        <div className="match-explanation">
                          <strong>Match Reason:</strong> {r.explanation}
                        </div>
                      )}

                      {r.Languages && r.Languages.length > 0 && (
                        <div className="tech-box">
                          <span className="tech-label">Primary Languages:</span>
                          <div className="tech-tags">
                            {r.Languages.map((lang, li) => (
                              <span key={li} className="tech-tag">
                                {lang}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="card-bottom">
                        {r.Profile_URL ? (
                          <a
                            href={r.Profile_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="github-link"
                          >
                            View GitHub Profile{" "}
                            <span className="visually-hidden">for @{r.Username} in new tab</span>{" "}
                            <span aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <span className="no-link">Profile link unavailable</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Semantic Bio Results */}
          {activeTab === "bio" && bioResults !== null && (
            <div className="results-wrapper">
              <div className="results-header">
                <div>
                  <h2 className="results-title">🧠 Semantic Concept Recommendations</h2>
                  <p className="results-meta">
                    Vector Space Search • Engine: <strong>{lastQuery?.engine || "TF-IDF Fallback"}</strong> • Retrieved{" "}
                    <strong>{bioResults.length}</strong> matching candidate{bioResults.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              <div className="score-disclaimer" role="note">
                <span className="disclaimer-icon" aria-hidden="true">💡</span>
                <p>
                  <strong>About Profile Similarity:</strong> Values represent cosine similarity computed by the active search engine ({lastQuery?.engine || "TF-IDF Fallback"}). {lastQuery?.engine?.includes("Sentence-BERT") ? "Dense vector embeddings represent semantic meaning." : "Lexical TF-IDF representations score word frequency alignment."} In accordance with platform privacy controls, raw candidate bios are kept confidential.
                </p>
              </div>

              {bioResults.length === 0 ? (
                <div className="empty-state" role="status">
                  <div className="empty-icon" aria-hidden="true">🔍</div>
                  <h3>No Concept Matches Found</h3>
                  <p>Try searching with broader technical terms, libraries, or project domains.</p>
                </div>
              ) : (
                <div className="card-grid">
                  {bioResults.map((r, i) => (
                    <article className="candidate-card" key={r.Username || i} aria-labelledby={`bio-cand-${i}-name`}>
                      <div className="card-top">
                        <div className="cand-info">
                          <div className="cand-avatar bio-avatar" aria-hidden="true">
                            {(r.Username || "U").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 id={`bio-cand-${i}-name`} className="cand-username">
                              @{r.Username}
                            </h3>
                            {r.Location && <span className="cand-loc">📍 {r.Location}</span>}
                          </div>
                        </div>
                        <div className="score-chip bio-chip" title="Cosine similarity in vector space">
                          <span className="score-label">
                            {lastQuery?.engine?.includes("Sentence-BERT") ? "Semantic Cosine" : "Profile Similarity"}
                          </span>
                          <span className="score-val">
                            {r.similarity != null ? `${(r.similarity * 100).toFixed(0)}%` : "N/A"}
                          </span>
                        </div>
                      </div>

                      <div className="card-bottom">
                        {r.Profile_URL ? (
                          <a
                            href={r.Profile_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="github-link"
                          >
                            View GitHub Profile{" "}
                            <span className="visually-hidden">for @{r.Username} in new tab</span>{" "}
                            <span aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <span className="no-link">Profile link unavailable</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* About & Contributor Modal (WCAG Accessible Dialog) */}
      {showAboutModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAboutModal(false)}
          role="presentation"
        >
          <div
            ref={aboutDialogRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="about-modal-title" className="modal-title">
                About Project Partner
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowAboutModal(false)}
                aria-label="Close about dialog"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-lead">
                <strong>GitHub Project Partner Recommendation System</strong> is a portfolio showcase implementation based on the <strong>CS 5661 Data Science university project</strong> at California State University, Los Angeles (Cal State LA).
              </p>
              <div className="modal-section">
                <h3 className="modal-subtitle">Original University Team Contributors & Roles</h3>
                <ul className="modal-team-list">
                  <li><strong>Ekta Mulkalwar</strong> – Lead Data Engineer & Content-Based Modeling</li>
                  <li><strong>Apoorva Durge</strong> – NLP & Feature Extraction (TF-IDF & Sentence-BERT)</li>
                  <li><strong>Anand Gutte</strong> – Collaborative Filtering & Activity Similarity Developer</li>
                  <li><strong>Mansi Aher</strong> – Data Cleaning Specialist</li>
                  <li><strong>Anvaya Chandrika Gudibanda Sreesha</strong> – Visualization & Geo Insights</li>
                  <li><strong>Shalini Nistala</strong> – Evaluation & Metrics Formulator</li>
                  <li><strong>Shah Drashti Kirtibai</strong> – Encoding & Feature Engineering</li>
                  <li><strong>Neel Jaysukhbhai Khunt</strong> – Repository & Documentation Lead</li>
                  <li><strong>Movva Jeevan Sidhardha</strong> – Location Processing Support</li>
                  <li><strong>Sai Kiran Bandapally</strong> – Repo Insights Engineer</li>
                </ul>
              </div>
              <div className="modal-section">
                <h3 className="modal-subtitle">Modernization & Engineering Enhancements</h3>
                <p className="modal-text">
                  This showcase demonstrates modern production software practices: vectorized dynamic scoring engine, cold-start handling, offline SBERT fallback, WCAG 2.2 AA accessibility, real-browser QA test harness, Vite migration, and dark developer dashboard styling.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShowAboutModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* University Attribution Footer */}
      <footer className="app-footer" role="contentinfo">
        <div className="footer-content">
          <div className="footer-top-row">
            <div>
              <p className="footer-title">
                <strong>GitHub Project Partner Recommendation System</strong>
              </p>
              <p className="footer-academic">
                Showcase implementation based on the <strong>CS 5661 Data Science university project</strong> (Cal State LA).
              </p>
            </div>
            <button
              type="button"
              className="btn-footer-about"
              onClick={() => setShowAboutModal(true)}
            >
              View Contributor Credits
            </button>
          </div>

          <details className="footer-team-details">
            <summary className="footer-summary">Original University Team Contributors & Roles</summary>
            <ul className="footer-team-list">
              <li><strong>Ekta Mulkalwar</strong> – Lead Data Engineer & Content-Based Modeling</li>
              <li><strong>Apoorva Durge</strong> – NLP & Feature Extraction (TF-IDF & Sentence-BERT)</li>
              <li><strong>Anand Gutte</strong> – Collaborative Filtering & Activity Similarity Developer</li>
              <li><strong>Mansi Aher</strong> – Data Cleaning Specialist</li>
              <li><strong>Anvaya Chandrika Gudibanda Sreesha</strong> – Visualization & Geo Insights</li>
              <li><strong>Shalini Nistala</strong> – Evaluation & Metrics Formulator</li>
              <li><strong>Shah Drashti Kirtibai</strong> – Encoding & Feature Engineering</li>
              <li><strong>Neel Jaysukhbhai Khunt</strong> – Repository & Documentation Lead</li>
              <li><strong>Movva Jeevan Sidhardha</strong> – Location Processing Support</li>
              <li><strong>Sai Kiran Bandapally</strong> – Repo Insights Engineer</li>
            </ul>
          </details>
          <p className="footer-copyright">
            Public developer metadata analyzed for educational portfolio matching. Raw candidate bios remain confidential.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
