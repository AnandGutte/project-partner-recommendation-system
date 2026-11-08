# ⚛️ Frontend — GitHub Project Partner Recommendation System

Modernized, responsive, and accessible React client for discovering technical project collaborators based on GitHub public metadata, interaction metrics, and bio semantics.

---

## 🚀 Key Features (Phase 2 Modernization)

1. **Dual Search Strategies (Tabbed Navigation):**
   - **Hybrid Partner Match:** Query candidate partners against any GitHub username, with filters for preferred location, clustering algorithm (`HDBSCAN` or `DBSCAN`), domain specialization, and top-k selection.
   - **Semantic Concept Search:** Free-text query matching project ideas and technical stacks directly in the Sentence-BERT vector space.
2. **Contextual Score & Metric Explanations:**
   - Displays **Portfolio Match Score** with explicit disclaimers: calculated via heuristic feature similarity across languages (45%), activity metrics (35%), and bio embeddings (20%). Clearly noted as portfolio similarity rather than a validated compatibility guarantee.
   - Shows component score chips (`Content`, `Activity`, `Bio`) when provided by the API.
3. **Privacy & Security Alignment:**
   - Respects backend security allowlists. Candidate raw bios are never displayed in client views.
   - All profile URLs are strictly verified against `https://github.com/[username]` format and open securely with `target="_blank" rel="noopener noreferrer"`.
4. **State Machine & User Feedback:**
   - **Loading State:** Accessible spinner with `aria-live="polite"` feedback.
   - **Empty Results State:** Actionable suggestions and one-click "Reset Filters" when candidate filters yield 0 matches.
   - **Validation Error State:** Inline client-side validation (e.g., username length $\le 39$, required fields).
   - **Network Error State:** Dismissible error banner distinguishing server validation errors from connection outages.
   - **Success State:** Dynamic count summary, domain chips, and smooth keyboard focus transfer to results.
5. **Accessibility (WCAG 2.2 AA Compliance):**
   - **WCAG 2.4.1:** Skip link to `#main-content`.
   - **WCAG 2.4.7:** Visible 2px focus rings (`:focus-visible`) for all interactive elements.
   - **WCAG 1.3.1 & 3.3.2:** Explicit `<label htmlFor="...">` bindings for every form input.
   - **WCAG 1.4.3:** Color contrast ratios $\ge 4.5:1$ for all text against backgrounds.
   - **WCAG 4.1.2 & 4.1.3:** ARIA landmarks, roles (`tablist`, `tab`, `alert`, `status`), and live regions.
6. **Mobile-First Responsive Layout:**
   - CSS Grid with auto-fit/auto-fill candidate cards (`repeat(auto-fill, minmax(360px, 1fr))`).
   - Touch targets $\ge 44 \times 44\text{px}$ on touch devices.
   - Stacked form layout on screens $< 640\text{px}$.

---

## 🛠️ Environment Configuration

Create a `.env` file in this directory (or use `.env.example`):

```bash
# URL of the Flask Backend API (defaults to http://127.0.0.1:5000)
REACT_APP_API_URL=http://127.0.0.1:5000
```

---

## 🧪 Available Scripts

### `npm start`
Runs the app in development mode at [http://localhost:3000](http://localhost:3000).

### `npm test`
Runs the automated React Testing Library test suite:
```bash
npm test -- --watchAll=false
```

### `npm run build`
Compiles an optimized, minified production build into the `build/` folder.
```bash
npm run build
```

---

## 👥 University Attribution & Contributor Acknowledgements

This showcase implementation is based on the **CS 5661 Data Science Class Project** at California State University, Los Angeles:
- **Lead Data Engineer & Content-Based Modeling:** Ekta Mulkalwar
- **NLP & Feature Extraction:** Apoorva Durge
- **Collaborative Filtering Developer:** Anand Gutte
- **Data Cleaning Specialist:** Mansi Aher
- **Visualization & Geo Insights:** Anvaya Chandrika Gudibanda Sreesha
- **Evaluation & Metrics:** Shalini Nistala
- **Encoding & Feature Engineering:** Shah Drashti Kirtibai
- **Repository & Documentation Lead:** Neel Jaysukhbhai Khunt
- **Location Processing Support:** Movva Jeevan Sidhardha
- **Repo Insights Engineer:** Sai Kiran Bandapally
