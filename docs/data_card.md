## 📊 Data Card: GitHub Project Partner Recommendation System

📌 Project Overview

## Project Title: GitHub Project Partner Recommendation System
Team: Ekta Mulkalwar, Apoorva Durge, Anand Gutte, Mansi Aher, Anvaya Chandrika Gudibanda Sreesha, Shalini Nistala, Shah Drashti Kirtibai, Neel Jaysukhbhai Khunt, Movva Jeevan Sidhardha, Sai Kiran Bandapally

## 📂 Dataset Summary

Dataset Name: GitHub User Profiles Dataset

Data Format: CSV

Number of Records: ~5000 users (after cleaning ~4000+ remain)

Data Source: Public GitHub REST API v3

Collection Method: Scraped using custom Python script (requests + GitHub token + geopy)


## 📄 Features Collected:

Username

Name

Bio

Public Repositories Count

Followers

Following

List of Repositories

Languages Used

Location (City/Country)

Latitude & Longitude (via Geopy)

GitHub Profile URL

## 🎯 Purpose of Dataset

The dataset was collected to power a hybrid recommendation system that suggests project partners based on:

Collaborative filtering (common user attributes or preferences)

Content-based filtering (similar skills, repositories, languages)

Optional NLP (for those who have bios)

## ⚙️ Data Collection Process

API Used: GitHub REST API v3

Tools: Python (requests, geopy, pandas)

Rate Limit Handling: Delay with time.sleep() to avoid hitting the GitHub API limit

Geolocation: Used Nominatim from geopy to get lat/lon from location string

## ✅ Data Preprocessing Summary

Missing values in fields like Bio, Repositories, Languages, Location filled with placeholders

Users with zero activity and no known data removed

Categorical variables (Languages, Location) encoded using LabelEncoder

Numerical values (Public Repos, Followers, Following) scaled using MinMaxScaler

## ⚠️ Limitations

Not all users have bios, location info, or rich repo data

Language detection limited to repo-level data, not user-declared skills

Geolocation dependent on user input (can be vague like "Remote")

## 🔒 Ethical Considerations

Only public data was used from GitHub

No personal, sensitive, or private user information was accessed

Dataset anonymized by removing names during modeling if not required

🔬 Intended Use

Educational use only: for developing and evaluating recommendation algorithms

Helps students match based on project interests, languages used, and GitHub history

📏 Evaluation Metrics

Cosine similarity for content-based filtering

Mean Average Precision, Recall@k for collaborative filtering validation

