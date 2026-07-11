## Obsidian Graph View — Template and Field Reference

Write `.obsidian/graph.json` with the following template. Replace `{subfolder}` with the configured subfolder name (e.g., `ai-knowledge`):

```json
{
  "collapse-filter": false,
  "search": "path:{subfolder} -path:{subfolder}/_raw -path:{subfolder}/_meta",
  "showTags": false,
  "showAttachments": false,
  "hideUnresolved": true,
  "showOrphans": false,
  "collapse-color-groups": false,
  "colorGroups": [
    { "query": "path:{subfolder}/concepts", "color": { "a": 1, "rgb": 5227007 } },
    { "query": "path:{subfolder}/synthesis", "color": { "a": 1, "rgb": 13724009 } },
    { "query": "path:{subfolder}/atlas", "color": { "a": 1, "rgb": 12945088 } },
    { "query": "path:{subfolder}", "color": { "a": 1, "rgb": 4473924 } }
  ],
  "collapse-display": true,
  "showArrow": true,
  "textFadeMultiplier": -1,
  "nodeSizeMultiplier": 2,
  "lineSizeMultiplier": 0.8,
  "collapse-forces": false,
  "centerStrength": 0.25,
  "repelStrength": 20,
  "linkStrength": 1,
  "linkDistance": 80
}
```

The `search` field filters the graph to only show content inside the subfolder while excluding `{subfolder}/_raw` and `{subfolder}/_meta`. Each `colorGroups` entry must include the subfolder prefix in its query path. The last entry is a catch-all fallback.

Path quoting rule (Obsidian search syntax): bare `path:folder` works for single-word or hyphenated names (e.g. `path:ai-knowledge`). If the subfolder name contains spaces, wrap in double quotes: `path:"my vault"`. Apply the same quoting rule to all `path:` values in both `search` and `colorGroups` entries.

If `.obsidian/graph.json` already exists, merge the `colorGroups` and force settings without overwriting user customizations to other fields. If `.obsidian/` does not exist, skip this step silently.
