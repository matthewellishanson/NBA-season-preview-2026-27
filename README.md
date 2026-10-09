# NBA-season-preview-2026-27
A full 30-team season preview package for the Hanson Hoops blog (deployed on GH pages) 

## Local preview

The historical ratings chart loads its generated CSV with `fetch`, so preview the repository through a local HTTP server rather than opening the HTML file directly:

```powershell
& .\.venv\Scripts\python.exe -m http.server 8000
```

Then open `http://localhost:8000/2026-27-previews-prototype.html#team-wizards`.
