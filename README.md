# ZVG Scraper

Dieser Scraper zieht aktuell Einfamilienhaeuser und Mehrfamilienhaeuser aus dem ZVG-Portal, laedt die Detailseiten, speichert die Daten in SQLite und exportiert weiterhin JSON/CSV fuer jeden Lauf.

## Voraussetzungen

- Node.js 24 oder neuer

## Installation

```powershell
$env:npm_config_cache='c:\Scale Invest Scaper\.npm-cache'
npm.cmd install
```

## Erste Tests

Kleiner Testlauf nur fuer Niedersachsen:

```powershell
npm.cmd run scrape:sample
```

Nationaler Lauf ueber alle Bundeslaender:

```powershell
npm.cmd run scrape
```

Die Ausgaben landen in `data/<timestamp>/` und zusaetzlich als aktuelle Kopie in:

- `data/latest.json`
- `data/latest.csv`
- `data/latest-summary.json`
- `data/zvg.sqlite`

## Viewer und Scrape-Trigger

```powershell
npm.cmd run serve
```

Danach ist unter `http://localhost:3000` verfuegbar:

- Marktansicht mit allen aktuell in SQLite gespeicherten Auktionen
- Pipeline-Ansicht fuer aktiv uebernommene Deals
- Objektakte fuer Deep-Dive-Analyse, Notizen und Deal-Status
- Button zum Starten eines neuen Scrape-Laufs
- Proxy fuer Dokument-Downloads ueber `/api/documents`
- Statusanzeige des letzten oder laufenden Scrapes

## Deal-Workflow im Tool

Der Scraper bleibt die reine Marktquelle. Darauf baut das Tool jetzt drei Arbeitsebenen auf:

1. `Markt`: vollstaendige Liste aller gescrapeten ZVG-Objekte
2. `Pipeline`: aktive Auswahl der fuer dich relevanten Deals
3. `Objektakte`: tiefe Analyse pro Objekt mit Status, Investment-These, Zielgebot und JSON-Feldern fuer Screening, Finanzanalyse und Due Diligence

Die Scrape-Logik selbst bleibt dabei unberuehrt. Neue Pipeline- und Analyse-Daten werden separat in SQLite gespeichert.

## Aktueller Umfang

- Suche ueber alle Bundeslaender
- Filter auf Objektarten `Einfamilienhaus` und `Mehrfamilienhaus`
- Parsing von Suchergebnis und Detailseite
- Export relevanter Felder inklusive Dokumentlinks
- Persistenz in SQLite mit Run-Historie und Dokumenttabelle

## Naechste sinnvolle Ausbaustufen

1. PDF-Dateien der Bekanntmachungen/Gutachten herunterladen und archivieren
2. Postgres fuer produktiven Mehrbenutzerbetrieb und API/Worker-Trennung
3. Weitere strukturierte Parser fuer Wohnflaeche, Grundstuecksgroesse, Leerstand, Baujahr
4. Alerting, Delta-Reports und eine bessere Filter-UI
