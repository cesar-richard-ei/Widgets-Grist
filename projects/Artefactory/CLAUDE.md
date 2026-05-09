# Projet : Artefactory AI v11

Widget Grist autonome (un seul fichier `index.html`, ~2200 lignes) qui sert d'IDE
no-code/low-code embarqué dans un document Grist. L'utilisateur peut créer,
éditer et prévisualiser des "artefacts" (composants React, HTML, widgets Grist,
SVG, Mermaid, Markdown) stockés directement comme lignes d'une table Grist.

## Contexte

- **Cas d'usage** : permettre à un utilisateur Grist d'écrire et tester des
  custom widgets sans sortir du document. Chaque artefact est une ligne dans la
  table `Artefacts`.
- **Aucun build** : tout tourne en navigateur via CDN (Ace Editor, Babel
  standalone, React 18, Tailwind CDN, Mermaid, html2canvas, marked).
- **UI en français** uniquement.
- **Pas de runtime applicatif** dans cette version : l'IDE ne sait pas composer
  plusieurs artefacts en application multi-routes. C'est une factory simple,
  pas un runtime.

## Architecture

Fichier unique : [index.html](index.html). Sections par marqueurs `// ============ XXX ============` :

| Section | Lignes (≈) | Rôle |
|---|---|---|
| `CONFIGURATION` | 602 | `TABLE_NAME`, `TABLE_COLS`, `TYPES` (templates par type) |
| `STATE` | 743 | Objet `state` global |
| `GRIST BRIDGE` | 782 | `GristBridgeParent` côté parent + `GRIST_BRIDGE_SCRIPT` injecté côté iframe |
| `INITIALIZATION` | 941 | `init()`, `ensureTable`, `loadArtefacts`, `loadGristSchema` (lazy) |
| `DOCUMENTATION UI` | 1119 | Chips de docs Markdown sélectionnables comme contexte IA |
| `UI UPDATES` | 1186 | `showInit`, `updateSelect`, `selectArtefact`, etc. |
| `CODE EDITOR EVENTS` | 1377 | Hot-reload Ace |
| `TYPE DETECTION` | 1426 | `detectType` (fallback uniquement, le `Type` Grist override) |
| `RENDER` | 1456 | `render`, `renderReact`, `renderHTML`, `renderGristWidget`, `renderFrame`, `renderSVG`, `renderMermaid`, `renderMarkdown` |
| `SPLITTER` | 1605 | Drag pour redimensionner code/preview |
| `VIEW CONTROLS` | 1651 | `setView`, `setDevice`, `toggleConsole`, etc. |
| `CONSOLE` | 1721 | Capture des `console.log/error` depuis l'iframe |
| `AI ASSISTANT` | 1756 | Quick prompt, panneau IA, `sendAIRequest`, `buildAIContext`, `handleAIResponse`, auto-correction |
| `KEYBOARD` | 2034 | Ctrl+S, Ctrl+K, Échap |
| `CREATE / SAVE` | 2052 | Modal de création, persistance `applyUserActions` |

### Le panneau IA

L'assistant IA n'est **pas** un agent. Il envoie un POST JSON à un webhook
configuré par l'utilisateur (`webhookUrl` + `apiKey` optionnel) et applique
automatiquement le code retourné. Tout l'intelligence est côté webhook.

**Pour brancher un agent (Claude, GPT, n8n, agent maison) : voir [README.md](README.md).**

### Types d'artefacts

Définis dans `TYPES` ([index.html:614](index.html#L614)) :

| Type | Mode Ace | Rendu |
|---|---|---|
| `react` | jsx | Babel standalone in-iframe, React 18, Recharts dispo, composants UI inlinés (Card, Button, Input, Badge) |
| `html` | html | iframe srcdoc avec Tailwind CDN |
| `grist` | html | iframe + bridge Grist injecté à la place de `grist-plugin-api.js` |
| `svg` | svg | rendu inline (scripts strippés) |
| `mermaid` | text | `mermaid.render` chargé à la demande |
| `markdown` | markdown | `marked.parse` |

### Grist Bridge

Pattern classique : les iframes Artefactory ne peuvent pas accéder à l'API
Grist directement (sandbox + cross-origin via srcdoc). Le bridge :

1. Côté parent : classe `GristBridgeParent` qui écoute `postMessage` des iframes
   et exécute les appels `grist.docApi.*` à leur place.
2. Côté iframe : `GRIST_BRIDGE_SCRIPT` (literal de chaîne) est **injecté à la
   place** du tag `<script src="grist-plugin-api.js">` via `injectGristBridge()`.
   Il expose un `window.grist` faux qui proxy via `postMessage`.
3. **Une seule iframe active à la fois** : `setCurrentIframe()` clear les
   callbacks à chaque rendu. Pas de support iframe imbriquée (cf. différence
   notée plus bas).

### Schéma Grist (option IA)

`loadGristSchema()` snapshot toutes les tables non-`_grist` du doc avec 3 lignes
d'exemple par table. **Chargé lazy** depuis le fix de mai 2026 :
- Pas chargé à `init()` (évite N×fetchTable au démarrage)
- Chargé au premier `change` de la checkbox `📊 Schéma Grist`
- Chargé en fallback dans `buildAIContext()` si la checkbox est cochée mais
  `state.gristSchema` est null (cas d'une checkbox restored depuis localStorage)

## Conventions spécifiques

- **Pas de framework** côté widget lui-même (vanilla JS + Ace + marked).
- **Tailwind via CDN** dans les templates (jamais dans le widget host).
- **Touts les commentaires et messages utilisateur en français.**
- **Pas d'emojis dans le code** (sauf dans les chaînes de status visibles à
  l'utilisateur — c'est l'identité visuelle du widget).
- **Persistance localStorage** sous la clé `artefactory_ai_config_v11`.
- **`grist.ready({ requiredAccess: 'full' })`** : nécessaire car le widget
  crée et modifie la table `Artefacts`.

### Schéma de la table `Artefacts`

Auto-créée par `ensureTable()` au premier lancement.

| Colonne | Type Grist | Notes |
|---|---|---|
| `Nom` | Text | Affiché dans le sélecteur |
| `Type` | Choice | `react / html / grist / svg / mermaid / markdown` |
| `Code` | Text | Source complète |
| `Description` | Text | Optionnel |
| `Tags` | ChoiceList | **Déclarée mais non utilisée par le widget**. Conservée pour compatibilité avec d'éventuels users qui s'en servent dans Grist directement. Ne pas la lire/écrire depuis le code widget tant qu'aucune feature ne l'exploite. |
| `IsDoc` | Bool | Si true + Type=markdown → l'artefact apparaît dans les chips "Documentation contextuelle" du panneau IA |
| `CreatedAt` | DateTime | Unix seconds (Grist convention) |

## État actuel

- **Bugs corrigés (mai 2026)** :
  - Boucle d'auto-correction infinie (`aiCorrectionCount` reset à chaque tour) → fix par paramètre `isAutoCorrect`
  - XSS potentielle dans `addAIMessage` (innerHTML sur réponse webhook) → fix par construction DOM (textContent + `<br>`)
  - `loadGristSchema` eagerly à `init()` → fix lazy
  - Race après création (`state.artefacts[length-1]`) → fix via `result.retValues[0]`
  - `detectType` faux positifs (markdown sur backticks, svg sur xmlns inline) → fix par patterns plus stricts
  - `cleanReactCode` ne gérait pas les imports multilignes → fix par `[\s\S]*?`
- **Pas encore implémenté** : opérations partielles côté IA (replace lines / insert at line). Le widget applique soit tout le buffer, soit la sélection.
- **Pas encore implémenté** : streaming de la réponse IA. C'est un POST one-shot.

## Points d'attention

### Sandbox iframe `allow-scripts allow-same-origin`

Combinaison qui annule l'isolation d'origine (puisque le srcdoc est forcément
même-origin). Nécessaire pour :
- `iframe.contentDocument` lu par `html2canvas` lors de la capture screenshot
- `console` patching (le hook `window.parent.postMessage` depuis l'iframe)

**Conséquence** : un artefact malveillant peut accéder au DOM du widget host. À
ne pas oublier si on ajoute des secrets côté widget. La clé d'API n8n stockée
dans localStorage **est lisible** par tout artefact rendu — c'est acceptable
parce que c'est la clé de l'utilisateur lui-même, mais à documenter pour des
multi-tenants futurs.

### Conversation history tronquée

`buildAIContext` envoie les 10 derniers messages avec `content.substring(0, 500)`
([index.html:1968](index.html#L1968)). Si la conversation contient un long bloc
de code dans un message, il est coupé silencieusement. Ne pas s'attendre à du
contexte conversationnel parfait.

### Hot-reload uniquement en mode `split`

`onCodeChange` n'enclenche le re-render que si `state.view === 'split'`
([index.html:1397](index.html#L1397)). En mode `code` seul, il faut Ctrl+Enter
ou changer de vue. Choix design délibéré.

### Pas de protection CSRF sur le webhook

Le webhook IA est appelé depuis le navigateur de l'utilisateur, avec son token.
Si on configure un webhook public sans Bearer token, n'importe qui peut le
solliciter. Toujours configurer une auth côté webhook (Bearer ou IP allowlist).

### auto-correction : 3 tours max, par envoi user

Compteur `aiCorrectionCount` reset uniquement quand l'utilisateur envoie un
nouveau prompt (pas lors d'une auto-correction). Au-delà de 3 corrections
successives, le widget abandonne et affiche "Limite atteinte (3/3)".

### Différence avec l'ancien Artefactory v12 (widget_app/)

Cette v11 est volontairement plus simple que la v12 historique
(`projects/widget_app/app.html`) :
- Pas de runtime Edit/Run avec sidebar et navigation entre routes
- Pas de types `app` (manifest), `component` (composant React réutilisable)
- Pas de système d'inclusion de composants (`window.app.include()`)
- Ajoute en revanche : Mermaid, documentation contextuelle (`IsDoc`)

Si on doit ré-introduire la composition multi-artefacts, repartir des patterns
documentés dans [../widget_app/CLAUDE.md](../widget_app/CLAUDE.md) (notamment
`prepareNestedHtml` et le retarget `window.parent.parent`).

## Fichiers

- [index.html](index.html) — widget complet
- [README.md](README.md) — installation + **branchement d'un agent IA** (contrat HTTP, limites du widget, patterns d'agent)
- [AGENT_SYSTEM_PROMPT.md](AGENT_SYSTEM_PROMPT.md) — system prompt prêt à l'emploi pour l'agent (à copier-coller côté webhook)
