import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import axios from "axios";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App.jsx";

vi.mock("axios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe("GitHub Project Partner Recommendation Component (Phase 2)", () => {
  const mockMetadata = {
    total_users: 3890,
    clustering_methods: {
      hdbscan: {
        label: "HDBSCAN (3 Stable Clusters)",
        domains: ["DevOps & Scripting", "Testing & Sparse Data", "Unknown Users"],
      },
      dbscan: {
        label: "DBSCAN (8 Granular Domains)",
        domains: ["Blockchain & Ripple Projects", "DevOps & Scripting"],
      },
    },
    sample_usernames: ["abhay", "mojombo", "defunkt"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockResolvedValue({ data: mockMetadata });
  });

  const renderComponent = async () => {
    let result;
    await act(async () => {
      result = render(<App />);
    });
    return result;
  };

  test("renders skip link, accessible landmarks, and header with metadata stats", async () => {
    await renderComponent();

    // WCAG 2.4.1 Skip link
    const skipLink = screen.getByRole("link", { name: /skip to main search content/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");

    // Accessible headings
    expect(
      screen.getByRole("heading", { level: 1, name: /GitHub Project Partner Recommendation/i })
    ).toBeInTheDocument();

    // Dataset stats pill after metadata fetch
    expect(screen.getByText(/3,890 Aligned Developer Profiles/i)).toBeInTheDocument();
  });

  test("populates sample username quick-picks and fills input on click", async () => {
    await renderComponent();

    expect(screen.getByText("@abhay")).toBeInTheDocument();

    const abhaySampleBtn = screen.getByRole("button", { name: "@abhay" });
    fireEvent.click(abhaySampleBtn);

    const usernameInput = screen.getByLabelText(/GitHub Username/i);
    expect(usernameInput).toHaveValue("abhay");
  });

  test("validates required username and displays client-side validation error", async () => {
    await renderComponent();

    const submitBtn = screen.getByRole("button", { name: /Find Project Partners/i });
    expect(submitBtn).toBeDisabled();

    const usernameInput = screen.getByLabelText(/GitHub Username/i);
    fireEvent.change(usernameInput, { target: { value: "   " } });
    expect(submitBtn).toBeDisabled();
  });

  test("switches between search tabs (Hybrid Match vs Semantic Concept)", async () => {
    await renderComponent();

    const hybridTab = screen.getByRole("tab", { name: /Hybrid Partner Match/i });
    const bioTab = screen.getByRole("tab", { name: /Semantic Concept Search/i });

    expect(hybridTab).toHaveAttribute("aria-selected", "true");
    expect(bioTab).toHaveAttribute("aria-selected", "false");

    // Switch to Semantic tab
    fireEvent.click(bioTab);
    expect(bioTab).toHaveAttribute("aria-selected", "true");
    expect(hybridTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText(/Project Concept or Ideal Partner Description/i)).toBeInTheDocument();

    // Switch back to Hybrid tab
    fireEvent.click(hybridTab);
    expect(hybridTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(/GitHub Username/i)).toBeInTheDocument();
  });

  test("fetches and renders partner cards with score breakdown and secure profile links", async () => {
    const mockRecommendations = [
      {
        Username: "raymorgan",
        Location: "San Francisco, CA",
        Profile_URL: "https://github.com/raymorgan",
        Domain_Tag: "DevOps & Scripting",
        hybrid_score: 0.88,
        content_score: 0.90,
        collab_score: 0.85,
        bio_score: 0.80,
        Languages: ["Erlang", "Ruby", "JavaScript"],
        explanation: "Shared languages: Erlang, Ruby. High activity metrics.",
      },
    ];

    axios.post.mockResolvedValueOnce({
      data: {
        query_user: "abhay",
        is_known_user: true,
        method: "hdbscan",
        count: 1,
        recommendations: mockRecommendations,
      },
    });

    await renderComponent();

    const usernameInput = screen.getByLabelText(/GitHub Username/i);
    fireEvent.change(usernameInput, { target: { value: "abhay" } });

    const submitBtn = screen.getByRole("button", { name: /Find Project Partners/i });
    expect(submitBtn).toBeEnabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: "@raymorgan" })).toBeInTheDocument();
      expect(screen.getByText("88%")).toBeInTheDocument();
      expect(screen.getByText(/Content: 90%/i)).toBeInTheDocument();
      expect(screen.getByText(/Activity: 85%/i)).toBeInTheDocument();
      expect(screen.getByText(/Bio: 80%/i)).toBeInTheDocument();
      expect(screen.getByText("Erlang")).toBeInTheDocument();
      expect(screen.getByText(/Shared languages: Erlang, Ruby/i)).toBeInTheDocument();
    });

    // Score disclaimer (Requirement 4)
    expect(screen.getByText(/About Recommendation Scores:/i)).toBeInTheDocument();

    // Secure GitHub Profile Link (Requirement 3 & 7)
    const githubLink = screen.getByRole("link", { name: /View raymorgan's GitHub profile in new tab/i });
    expect(githubLink).toHaveAttribute("href", "https://github.com/raymorgan");
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("renders helpful empty state when search returns 0 candidates", async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        query_user: "abhay",
        count: 0,
        recommendations: [],
      },
    });

    await renderComponent();

    const usernameInput = screen.getByLabelText(/GitHub Username/i);
    fireEvent.change(usernameInput, { target: { value: "abhay" } });

    const submitBtn = screen.getByRole("button", { name: /Find Project Partners/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: /No Matching Developer Profiles Found/i })).toBeInTheDocument();
      expect(screen.getByText(/Try selecting/i)).toBeInTheDocument();
    });
  });

  test("handles server and network errors gracefully with dismissible alert banner", async () => {
    axios.post.mockRejectedValueOnce({
      response: {
        data: { error: "Location must be at most 120 characters." },
      },
    });

    await renderComponent();

    const usernameInput = screen.getByLabelText(/GitHub Username/i);
    fireEvent.change(usernameInput, { target: { value: "abhay" } });

    const submitBtn = screen.getByRole("button", { name: /Find Project Partners/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText(/Location must be at most 120 characters/i)).toBeInTheDocument();
    });

    const dismissBtn = screen.getByRole("button", { name: /Dismiss alert/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("performs semantic concept search and never displays raw candidate bio", async () => {
    const mockBioMatches = [
      {
        Username: "octocat",
        Location: "San Francisco, CA",
        Profile_URL: "https://github.com/octocat",
        similarity: 0.82,
        Bio: "Secret candidate bio that must remain private",
      },
    ];

    axios.post.mockResolvedValueOnce({
      data: {
        engine: "Sentence-BERT (all-MiniLM-L6-v2)",
        count: 1,
        recommendations: mockBioMatches,
      },
    });

    await renderComponent();

    const bioTab = screen.getByRole("tab", { name: /Semantic Concept Search/i });
    fireEvent.click(bioTab);

    const bioInput = screen.getByLabelText(/Project Concept or Ideal Partner Description/i);
    fireEvent.change(bioInput, { target: { value: "machine learning python pytorch" } });

    const searchBtn = screen.getByRole("button", { name: /Search Semantic Matches/i });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: "@octocat" })).toBeInTheDocument();
      expect(screen.getByText("82%")).toBeInTheDocument();
      expect(screen.getByText(/Semantic Cosine/i)).toBeInTheDocument();
    });

    // Requirement 9: Verify candidate raw bio is not exposed
    expect(screen.queryByText(/Secret candidate bio that must remain private/i)).not.toBeInTheDocument();
  });

  test("resets form and clears active results when Reset Form is clicked", async () => {
    await renderComponent();

    const usernameInput = screen.getByLabelText(/GitHub Username/i);
    fireEvent.change(usernameInput, { target: { value: "abhay" } });
    expect(usernameInput).toHaveValue("abhay");

    const resetBtn = screen.getByRole("button", { name: /Reset Form/i });
    fireEvent.click(resetBtn);

    expect(usernameInput).toHaveValue("");
  });
});
