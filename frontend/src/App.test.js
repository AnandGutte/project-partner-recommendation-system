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
          hdbscan: { domains: ["DevOps & Scripting", "Testing & Sparse Data", "Unknown Users"] },
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

  test('disables action buttons when inputs are empty', () => {
    render(<App />);
    const partnerButton = screen.getByRole('button', { name: /Get Partner Matches/i });
    const bioButton = screen.getByRole('button', { name: /Get Bio Matches/i });

    expect(partnerButton).toBeDisabled();
    expect(bioButton).toBeDisabled();
  });

  test('enables partner button when username is entered', () => {
    render(<App />);
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
