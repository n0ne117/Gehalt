# Gehalt

Web-App zur Erfassung von Brutto-/Netto-Gehältern – eine Migration der
`Gehalt.xlsx`-Tabelle. Läuft als Docker-Compose-Service; die eingegebenen Daten
werden serverseitig als JSON-Datei gespeichert.

## Starten

### Fertiges Image (z. B. auf einem Server)

Bei jedem Push auf `main` baut GitHub Actions ein Image (amd64 + arm64) und
veröffentlicht es als `ghcr.io/n0ne117/gehalt:latest`. Auf dem Server genügt
die `docker-compose.yml` in einem leeren Ordner:

```bash
mkdir gehalt && cd gehalt
curl -fsSLO https://raw.githubusercontent.com/n0ne117/Gehalt/main/docker-compose.yml
mkdir data && docker compose pull && docker compose up -d
```

Update: `docker compose pull && docker compose up -d`

### Aus dem Quellcode

```bash
docker compose up --build
```

Dann im Browser öffnen: <http://localhost:9605>

Beim ersten Start ist die App leer. Vorhandene Daten werden über **Import**
geladen (siehe unten).

### Lokal ohne Docker

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
DATA_FILE=./data/gehalt.json .venv/bin/uvicorn app:app --app-dir backend --port 9605
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
- **Export** lädt alle Daten als `gehalt-JJJJ-MM-TT.json` herunter.
- **Import** lädt eine solche Datei und **ersetzt** alle aktuellen Daten
  (mit Rückfrage). Akzeptiert auch eine reine Liste von Jahren.
- Liegt die Erhöhung im Jänner, wird mit dem Dezember des Vorjahres verglichen.

## Speicherung

Die Daten liegen in **`./data/gehalt.json`** im Projektordner (im Container
als `/data` eingebunden). Die Datei bleibt über Rebuilds hinweg erhalten und
lässt sich direkt sichern oder kopieren.
Private Daten (`data/`, `*.xlsx`, `gehalt*.json`, `seed.json`) sind
per `.gitignore` vom Repository ausgeschlossen.

**Sicherung:** `data/gehalt.json` kopieren oder in der App *Export* nutzen.

**Umzug auf eine neue Instanz:** in der alten App *Export*, neue Instanz
starten, dort *Import*. Ältere Versionen ohne Export-Knopf speicherten in
einem Docker-Volume; die Datei lässt sich dort so herausholen:

```bash
docker compose cp gehalt:/data/gehalt.json ./gehalt-backup.json
```

## Aufbau

| Pfad | Inhalt |
|------|--------|
| `backend/app.py` | FastAPI-Server (API + Auslieferung des Frontends) |
| `frontend/` | Single-Page-App (HTML / CSS / JS, ohne Build-Schritt) |
| `Dockerfile`, `docker-compose.yml` | Container-Setup |
| `.github/workflows/docker.yml` | Baut und veröffentlicht das Image (ghcr.io) |

## API

| Methode | Pfad | Zweck |
|---------|------|-------|
| `GET` | `/api/data` | gesamten Datensatz lesen |
| `PUT` | `/api/data` | gesamten Datensatz ersetzen (validiert, atomar) |
| `GET` | `/api/export` | gesamten Datensatz als Datei-Download |
| `GET` | `/api/health` | Health-Check |
| `GET` | `/api/docs` | OpenAPI-Doku |
