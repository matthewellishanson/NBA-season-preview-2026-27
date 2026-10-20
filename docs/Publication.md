# Publication workflow

## Destination

The season preview is prepared for this stable GitHub Pages URL:

`https://matthewellishanson.github.io/hanson-hoops/2026-27-team-previews/`

The deployable folder is `dist/2026-27-team-previews/`. It contains only the
page and runtime assets used by the published package. A matching copy is staged
at `C:\Users\mehan\code\matthewellishanson.github.io\hanson-hoops\2026-27-team-previews\`,
and the Hanson Hoops index links to it.

## Publication source of truth

The `teams` array in `2026-27-team-previews.html` controls rankings and release
status. A completed preview has `status: "published"` and an explicit local
`logo` path. The page derives the completion count, completed navigation,
preview cards, mobile selector, and upcoming list from that status.

To publish the next completed preview:

1. Add the finished prose/chart markup using the existing team branch and
   preserve the team's current `slug`, `code`, and `powerRank`.
2. Change only that team's status to `"published"` and add its local logo path.
3. Copy the updated page and any newly required runtime assets into the matching
   paths under `dist/2026-27-team-previews/` and the staged site folder.
4. Serve the site repository over HTTP and run:

   `node scripts/verify_publication.mjs http://127.0.0.1:8001/hanson-hoops/2026-27-team-previews/ artifacts/publication-site`

5. Review the desktop and mobile screenshots, then commit and push the site
   repository after approval.

The fixed editorial update date is the `<time datetime>` value in the hero. It
must be changed deliberately when the package is editorially updated; it is not
derived from the browser date.
