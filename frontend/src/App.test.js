import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from './App';

// Mock axios to avoid live network calls during unit tests
jest.mock('axios');

describe('GitHub Project Partner Recommendation Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({
      data: {
        total_users: 3890,
        clustering_methods: {
          hdbscan: { domains: ["DevOps & Scripting", "Testing & Sparse Data", "Unknown Users", "Fixture metadata domain"] },
          dbscan: { domains: ["Blockchain & Ripple Projects", "DevOps & Scripting"] },
        },
      },
    });
  });

  test('renders application heading and primary input elements', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/GitHub Project Partner Recommendation/i)).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/GitHub Username/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Preferred Location/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter Bio to Get Semantic Matches/i)).toBeInTheDocument();
  });

  test('disables action buttons when inputs are empty', async () => {
    render(<App />);
    await screen.findByRole('option', { name: 'Fixture metadata domain' });
    const partnerButton = screen.getByRole('button', { name: /Get Partner Matches/i });
    const bioButton = screen.getByRole('button', { name: /Get Bio Matches/i });

    expect(partnerButton).toBeDisabled();
    expect(bioButton).toBeDisabled();
  });

  test('enables partner button when username is entered', async () => {
    render(<App />);
    await screen.findByRole('option', { name: 'Fixture metadata domain' });
    const usernameInput = screen.getByPlaceholderText(/GitHub Username/i);
    const partnerButton = screen.getByRole('button', { name: /Get Partner Matches/i });

    fireEvent.change(usernameInput, { target: { value: 'abhay' } });
    expect(partnerButton).toBeEnabled();
  });

  test('fetches and displays partner recommendations on submit', async () => {
    const mockRecommendations = [
      {
        Username: 'octocat',
        Location: 'San Francisco, CA',
        Profile_URL: 'https://github.com/octocat',
        Domain_Tag: 'DevOps & Scripting',
        hybrid_score: 0.88,
      },
    ];

    axios.post.mockResolvedValueOnce({ data: mockRecommendations });

    render(<App />);
    const usernameInput = screen.getByPlaceholderText(/GitHub Username/i);
    const partnerButton = screen.getByRole('button', { name: /Get Partner Matches/i });

    fireEvent.change(usernameInput, { target: { value: 'abhay' } });
    fireEvent.click(partnerButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 4, name: /octocat/i })).toBeInTheDocument();
      expect(screen.getByText(/0.88/i)).toBeInTheDocument();
      expect(screen.getAllByText(/DevOps & Scripting/i).length).toBeGreaterThan(0);
    });
  });

  test('renders a privacy-filtered bio match without a raw candidate bio', async () => {
    axios.post.mockResolvedValueOnce({
      data: [{ Username: 'octocat', Location: null, Profile_URL: null, similarity: 0.81 }],
    });
    render(<App />);
    await screen.findByRole('option', { name: 'Fixture metadata domain' });

    fireEvent.change(screen.getByPlaceholderText(/Enter Bio to Get Semantic Matches/i), {
      target: { value: 'python' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Get Bio Matches/i }));

    expect(await screen.findByRole('heading', { level: 4, name: 'octocat' })).toBeInTheDocument();
    expect(screen.getByText(/Similarity: 0.81/i)).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/semantic-bio-recommend$/), {
      bio: 'python',
    });
  });

  test('displays error message when recommendation request fails', async () => {
    axios.post.mockRejectedValueOnce(new Error('Network Error'));

    render(<App />);
    const usernameInput = screen.getByPlaceholderText(/GitHub Username/i);
    const partnerButton = screen.getByRole('button', { name: /Get Partner Matches/i });

    fireEvent.change(usernameInput, { target: { value: 'abhay' } });
    fireEvent.click(partnerButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch partner recommendations/i)).toBeInTheDocument();
    });
  });
});
