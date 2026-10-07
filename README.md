# Gehalt

Web-App zur Erfassung von Brutto-/Netto-Gehältern – eine Migration der
`Gehalt.xlsx`-Tabelle. Läuft als Docker-Compose-Service; die eingegebenen Daten
werden serverseitig als JSON-Datei gespeichert.

## Starten

```bash
docker compose up --build
```

Dann im Browser öffnen: <http://localhost:9605>

Beim ersten Start wird die Datenbasis aus `backend/seed.json` angelegt, falls
diese Datei vorhanden ist (sonst startet die App leer). `seed.json` enthält
private Gehaltsdaten und ist deshalb **nicht** im Repository (`.gitignore`).

### Lokal ohne Docker

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
DATA_FILE=./backend/data/gehalt.json .venv/bin/uvicorn app:app --app-dir backend --port 9605
```

## Bedienung

- Jede Jahres­zeile besteht aus drei Reihen: **Brutto**, **Netto**,
  **Ø pro Monat** – genau wie in der Excel-Datei.
- Die 12 Monatsfelder (Jänner – Dezember) sind editierbar. Dezimaltrennzeichen
  Komma **oder** Punkt werden akzeptiert.
- Automatisch berechnet werden:
  - **Total** – Summe der 12 Monate (Ø-Zeile = Netto-Total ÷ 12)
  - **Δ Vorjahr** – Differenz zum Vorjahr (grün = mehr, rot = weniger)
  - **Gehaltserhöhung** – Erhöhung € / % aus dem Sprung vom Vormonat auf den
    Erhöhungsmonat (Standard: Juli; pro Jahr einstellbar).
- **% KV** (Kollektivvertrag) wird von Hand eingegeben.
- Änderungen werden automatisch gespeichert (Status oben rechts).
- **+ Jahr hinzufügen** ergänzt ein neues Jahr; das ✕ löscht eines.
- Liegt die Erhöhung im Jänner, wird mit dem Dezember des Vorjahres verglichen.

## Speicherung

Die Daten liegen in einer JSON-Datei im Docker-Volume `gehalt-data`
(`/data/gehalt.json` im Container; Docker benennt das Volume meist
`gehalt_gehalt-data`). Das Volume bleibt über Rebuilds hinweg erhalten.
Private Daten (`seed.json`, `backend/data/`, `*.xlsx`, `gehalt*.json`) sind
per `.gitignore` vom Repository ausgeschlossen. Sicherungskopie:

```bash
docker compose cp gehalt:/data/gehalt.json ./gehalt-backup.json
```

## Aufbau

| Pfad | Inhalt |
|------|--------|
| `backend/app.py` | FastAPI-Server (API + Auslieferung des Frontends) |
| `backend/seed.json` | Aus der Excel-Datei importierte Startdaten (privat, nicht im Repo) |
| `frontend/` | Single-Page-App (HTML / CSS / JS, ohne Build-Schritt) |
| `Dockerfile`, `docker-compose.yml` | Container-Setup |

## API

| Methode | Pfad | Zweck |
|---------|------|-------|
| `GET` | `/api/data` | gesamten Datensatz lesen |
| `PUT` | `/api/data` | gesamten Datensatz ersetzen (validiert, atomar) |
| `GET` | `/api/health` | Health-Check |
| `GET` | `/api/docs` | OpenAPI-Doku |
