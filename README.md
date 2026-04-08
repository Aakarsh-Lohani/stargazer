# 🌌 StarGazer — Multi-Agent Space Observation Assistant

> **AI-powered space observation planning** — Track the ISS, find meteor showers, check weather conditions, locate dark sky spots, and schedule stargazing events — all in one conversation.

Built with **Google ADK** + **Gemini** on **Vertex AI** + **BigQuery** + **Google Maps MCP** + **Google Calendar API**

---

## ✨ Features

| Feature | Agent | Integration |
|---|---|---|
| 🛰️ Real-time ISS tracking & pass predictions | `orbital_agent` | WhereTheISS.at API |
| 🚀 Upcoming rocket launches (SpaceX, ISRO, Artemis) | `orbital_agent` | Launch Library 2 API |
| ☄️ Meteor showers, eclipses, full moons | `orbital_agent` | Curated dataset |
| 🌤️ Weather GO/NO-GO analysis | `weather_agent` | OpenWeatherMap API |
| 🗺️ Dark sky location finder | `logistics_agent` | **Google Maps MCP** |
| 📅 Calendar event scheduling with mission briefs | `logistics_agent` | Google Calendar API |
| 📊 Audit logging & event caching | All agents | Google BigQuery |

---

## 🏗️ Architecture

```
User → StarGazer UI (HTML/CSS/JS)
         │
         ▼
    FastAPI Server (port 8080)
         │
         ▼
    ADK Runner + Session Service
         │
         ▼
┌─────────────────────────────────────┐
│    root_agent (Greeter/Orchestrator) │
│    gemini-2.0-flash via Vertex AI    │
└──────┬────────┬──────────┬──────────┘
       │        │          │
       ▼        ▼          ▼
 orbital_   weather_   logistics_
  agent      agent       agent
    │          │           │
    ▼          ▼           ▼
 ISS API   OpenWeather  Maps MCP +
 Launches  (GO/NO-GO)   Calendar
    │                      │
    └──── BigQuery ────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.12+
- Google Cloud project with billing enabled
- [OpenWeatherMap API key](https://openweathermap.org/api) (free)
- [Google Maps API key](https://console.cloud.google.com/apis/credentials) (free $200/mo credit)

### 1. Clone & Setup
```bash
git clone <your-repo-url>
cd stargazer
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your project ID and API keys
```

### 3. Enable Google Cloud APIs
```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com \
  compute.googleapis.com \
  bigquery.googleapis.com \
  calendar-json.googleapis.com \
  maps-backend.googleapis.com \
  places-backend.googleapis.com \
  secretmanager.googleapis.com
```

### 4. Create Service Account
```bash
export PROJECT_ID=$(gcloud config get project)
export SA_NAME=stargazer-sa
export SERVICE_ACCOUNT=${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com

gcloud iam service-accounts create ${SA_NAME} \
  --display-name="StarGazer Service Account"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/bigquery.dataEditor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/bigquery.jobUser"
```

### 5. Setup BigQuery
```bash
bq mk --dataset --location=US ${PROJECT_ID}:stargazer_db

bq mk --table ${PROJECT_ID}:stargazer_db.event_log \
  user_id:STRING,request:STRING,event_type:STRING,event_name:STRING,event_time:TIMESTAMP,location:STRING,weather_status:STRING,calendar_event_id:STRING,created_at:TIMESTAMP

bq mk --table ${PROJECT_ID}:stargazer_db.space_events \
  event_type:STRING,event_name:STRING,event_time:TIMESTAMP,details:STRING,cached_at:TIMESTAMP
```

### 6. Verify Model Access
```bash
# Ensure gemini-2.0-flash is available in your region
python -c "
from google import genai
client = genai.Client(vertexai=True, project='YOUR_PROJECT_ID', location='us-central1')
response = client.models.generate_content(model='gemini-2.0-flash', contents='Hello')
print('Model OK:', response.text[:50])
"
```

### 7. Run Locally
```bash
uvicorn server:app --host 0.0.0.0 --port 8080 --reload
```

Open http://localhost:8080 in your browser.

---

## 📅 Calendar Setup (Optional)

Calendar integration is **optional** — the app works without it. To enable:

```bash
# 1. Create OAuth 2.0 Client ID (Desktop App) in Cloud Console
# 2. Download credentials.json
# 3. Run locally to get refresh token:

pip install google-auth-oauthlib
python -c "
from google_auth_oauthlib.flow import InstalledAppFlow
flow = InstalledAppFlow.from_client_secrets_file('credentials.json',
    ['https://www.googleapis.com/auth/calendar'])
creds = flow.run_local_server(port=0)
print('Refresh token:', creds.refresh_token)
print('Client ID:', creds.client_id)
print('Client Secret:', creds.client_secret)
"

# 4. Add to .env:
# GOOGLE_OAUTH_CLIENT_ID=...
# GOOGLE_OAUTH_CLIENT_SECRET=...
# GOOGLE_CALENDAR_REFRESH_TOKEN=...
# CALENDAR_ID=your_email@gmail.com
```

---

## ☁️ Deploy to Cloud Run

### Store Secrets
```bash
echo -n "YOUR_KEY" | gcloud secrets create openweather-api-key --data-file=-
echo -n "YOUR_KEY" | gcloud secrets create maps-api-key --data-file=-
echo -n "YOUR_TOKEN" | gcloud secrets create calendar-refresh-token --data-file=-
echo -n "YOUR_ID" | gcloud secrets create google-oauth-client-id --data-file=-
echo -n "YOUR_SECRET" | gcloud secrets create google-oauth-client-secret --data-file=-
echo -n "email@gmail.com" | gcloud secrets create calendar-id --data-file=-

# Grant access
gcloud secrets add-iam-policy-binding openweather-api-key \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding maps-api-key \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

### Deploy
```bash
chmod +x deploy.sh
./deploy.sh
```

The deploy script builds a Docker image, pushes it to GCR, and deploys to Cloud Run with all secrets injected.

---

## 🧪 Test Queries

```
"I want to see the ISS tonight from Mumbai"
"Show me upcoming Artemis 2 launch details and check weather in Florida"
"What meteor showers are coming up? I'm in Delhi."
"Show me upcoming eclipses"
"Find a dark sky spot near Bangalore and schedule a stargazing event"
```

---

## 📁 Project Structure

```
stargazer/
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── README.md
├── requirements.txt
├── deploy.sh
├── server.py                         ← FastAPI (UI + Agent API)
├── stargazer_agent/
│   ├── __init__.py
│   ├── agent.py                      ← All agents + root_agent
│   └── tools/
│       ├── __init__.py
│       ├── space_tools.py            ← ISS, launches, celestial events
│       ├── weather_tools.py          ← OpenWeatherMap GO/NO-GO
│       ├── maps_tools.py             ← Google Maps MCP (remote)
│       ├── calendar_tools.py         ← Google Calendar API tool
│       └── db_tools.py               ← BigQuery audit logging
└── static/
    ├── index.html                    ← StarGazer UI
    ├── styles.css                    ← Space theme
    └── app.js                        ← Frontend logic
```

---

## 🔑 MCP vs API Tool Architecture

| Integration | Type | Protocol |
|---|---|---|
| Google Maps (dark sky finder) | **MCP** | `MCPToolset` + `StreamableHTTPConnectionParams` to `maps.googleapis.com/maps/api/mcp/v1` |
| Google Calendar | API Tool | OAuth 2.0 + REST API v3 |
| OpenWeatherMap | API Tool | REST API with API key |
| WhereTheISS.at | API Tool | Public REST API |
| Launch Library 2 | API Tool | Public REST API |
| Google BigQuery | API Tool | Python client library |

---
