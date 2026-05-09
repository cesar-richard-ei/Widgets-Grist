# Artefactory AI

IDE no-code embarqué dans Grist comme custom widget. Permet de créer, éditer
et prévisualiser des composants React, HTML, widgets Grist, SVG, Mermaid et
Markdown — directement comme lignes d'une table Grist. Inclut un assistant IA
qui délègue toute la génération à un webhook que tu configures (Claude, GPT,
n8n, agent maison…).

> Pour les conventions de développement et l'architecture interne du widget,
> voir [CLAUDE.md](CLAUDE.md).

## Installation dans Grist

1. Ouvrir un document Grist (self-hosted ou cloud).
2. Ajouter un Custom Widget pointant vers `index.html` (raw GitHub ou
   GitHub Pages).
3. Lui donner l'access level **Full** (le widget crée la table `Artefacts`
   au premier lancement).
4. Premier lancement : la table `Artefacts` apparaît automatiquement, prête à
   recevoir tes premiers artefacts.

## Utilisation

| Action | Raccourci |
|---|---|
| Sauvegarder l'artefact courant dans Grist | **Ctrl+S** |
| Ouvrir le quick prompt IA | **Ctrl+K** |
| Exécuter le code en cours | **Ctrl+Entrée** |
| Quitter le plein écran | **Échap** |

Vues disponibles : `Rendu` / `Code` / `Split` (par défaut). Hot-reload
automatique en mode `Split` (~800ms après la dernière frappe).

Trois devices simulés : Desktop / Tablet / Mobile (frame autour de l'iframe,
purement visuel — la mise en page reste à la charge du code de l'artefact).

## Documentation contextuelle pour l'IA

Quand tu crées un artefact de type **Markdown** et que tu coches **"Cet artefact
est une documentation"** :

- Il apparaît comme chip cliquable dans le panneau IA et dans le quick prompt.
- Quand il est sélectionné, son contenu est joint à chaque requête envoyée au
  webhook (clé `documentation`).

C'est le mécanisme prévu pour passer à l'agent : conventions de code maison,
schéma de tables tiers, règles métier, format de sortie attendu, etc.

## Brancher un agent IA

Le widget **n'embarque aucune logique d'agent**. L'assistant est un simple
client HTTP qui :

1. Construit un body JSON décrivant l'état (code courant, sélection,
   conversation, docs, schéma Grist optionnel, screenshot optionnel).
2. POST vers l'URL configurée dans le panneau IA.
3. Applique automatiquement le code retourné dans l'éditeur et redéclenche un
   rendu.

**Toute l'intelligence est côté webhook.** C'est lui qui doit appeler Claude /
GPT / un agent custom et formater la réponse.

### Contrat HTTP

#### Requête

```
POST <webhookUrl>
Content-Type: application/json
Authorization: Bearer <apiKey>     ← optionnel, présent uniquement si renseigné
```

Body envoyé (clés toujours présentes en gras) :

```jsonc
{
  "prompt":        "string",            // Texte saisi par l'utilisateur
  "code":          "string",            // Code complet OU sélection (selon codeContext)
  "codeContext":   "full" | "selection",
  "mode":          "react" | "html" | "grist" | "svg" | "mermaid" | "markdown",
  "artefactName":  "string",
  "artefactId":    123,
  "console":       ["msg1", "..."],     // 5 dernières erreurs console capturées
  "timestamp":     "2026-05-09T13:42:00.000Z",
  "useVision":     false,

  // Présent UNIQUEMENT si codeContext === "selection" :
  "selection": { "startLine": 12, "endLine": 18, "startCol": 0, "endCol": 0 },
  "fullCode":  "code complet (utile pour le contexte autour de la sélection)",

  // Présent UNIQUEMENT si l'utilisateur a coché des docs :
  "documentation": [
    {
      "id":          7,
      "name":        "Conventions React maison",
      "description": "Règles de naming, structure JSX...",
      "content":     "# Conventions\n\n- Toujours..."
    }
  ],

  // Présent UNIQUEMENT si la checkbox "Schéma Grist" est cochée :
  "gristSchema": {
    "Tasks": {
      "name":       "Tasks",
      "columns":    ["Title", "Status", "DueDate"],
      "sampleData": [{ "id": 1, "Title": "...", "Status": "open", "DueDate": 1715000000 }]
    }
    // ... une entrée par table non-_grist
  },

  // Présent UNIQUEMENT si le bouton 📸 est actif :
  "screenshot": "data:image/jpeg;base64,...",

  // 10 derniers messages de la conversation, contenu tronqué à 500 chars chacun :
  "conversation": [
    { "role": "user",      "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

#### Réponse attendue

```jsonc
{
  "code":             "nouveau code à appliquer",     // optionnel
  "message":          "Texte affiché dans le chat",   // optionnel
  "replaceSelection": true,                           // optionnel, défaut true
  "error":            "message d'erreur"              // optionnel, affiché en rouge
}
```

Aliases acceptés (cf. `handleAIResponse` dans [index.html](index.html)) :
- `code` peut aussi s'appeler `content` ou `response`
- `message` peut aussi s'appeler `explanation`

#### Comportements à connaître

1. **Application automatique** : si la réponse contient `code`, il est injecté
   immédiatement dans Ace, sauvegardé en `state.code`, et un re-rendu est
   déclenché. **L'agent n'a pas à demander confirmation.**
2. **Sélection vs full** : quand `codeContext === "selection"`, par défaut le
   `code` retourné **remplace seulement la sélection**. Pour remplacer tout le
   buffer malgré la sélection active : renvoyer `replaceSelection: false`.
3. **Auto-correction** : si une erreur console apparaît dans les ~1.5s suivant
   l'application du code, le widget renvoie automatiquement une nouvelle
   requête avec `prompt: "Corrige les erreurs suivantes:\n…"` (jusqu'à 3 fois).
   **L'agent doit donc être idempotent** et savoir corriger du code qu'il a
   lui-même produit.
4. **Pas de streaming** : POST JSON one-shot. Si tu veux du streaming, il
   faudra étendre le widget côté `sendAIRequest`.
5. **Timeout par défaut** : 30 secondes côté `fetch` browser (puis erreur
   réseau classique).

### Limites du widget que ton agent doit connaître

Pour que l'agent génère du code qui **fonctionne réellement** dans Artefactory,
il doit respecter les contraintes ci-dessous. Un agent qui invente une API
non listée produira du code qui crash silencieusement à l'exécution.

#### APIs Grist disponibles dans le bridge (liste fermée)

Le widget injecte un faux `window.grist` côté iframe ([index.html:904](index.html#L904))
qui proxy vers le vrai Grist. **Seules** les APIs ci-dessous sont disponibles :

| API | Disponible | Note |
|---|---|---|
| `grist.ready(options)` | ✅ | Toujours appeler en premier |
| `grist.docApi.listTables()` | ✅ | Retourne `string[]` |
| `grist.docApi.fetchTable(id)` | ✅ | Format colonnaire `{ id: [], Col: [] }` |
| `grist.docApi.applyUserActions(actions)` | ✅ | `AddRecord`, `UpdateRecord`, `RemoveRecord`, multi-actions |
| `grist.docApi.getAccessToken(opts)` | ✅ | Pour appels REST signés |
| `grist.onRecords(cb)` | ✅ | `(records, mappings) => void` |
| `grist.onRecord(cb)` | ✅ | `(record, mappings) => void` ; `record` peut être `null` |
| `grist.onOptions(cb)` | ✅ | Lecture des options du widget |
| `grist.setCursorPos({rowId})` | ✅ | Navigation vers une ligne |
| `grist.getTable(id).{create,update}()` | ✅ | Sucre syntaxique sur `applyUserActions` |
| `grist.mapColumnNames(record, mappings)` | ✅ | Helper de mapping |
| `grist.setOptions(opts)` | ❌ | **NON exposé** par le bridge |
| `grist.selectedTable` | ❌ | **NON exposé** — passer le `tableId` via `mappings.tableId` ou en dur |
| `window.app.*` (navigate / emit / on / state) | ❌ | **N'EXISTE PAS en v11** — c'est une feature de l'ancien runtime v12 (`projects/widget_app/`) |

Si l'agent génère `grist.setOptions(...)` ou `grist.selectedTable`, l'artefact
crashera avec `TypeError`. Si l'agent génère `window.app.navigate(...)`,
même chose.

#### Environnement d'exécution par type d'artefact

**Type `react`** ([index.html:1475](index.html#L1475)) :
- React 18 + ReactDOM 18 (UMD)
- Babel standalone (pas de résolveur de modules → **pas d'imports / exports**)
- Tailwind via CDN
- Recharts **2.12.7** (versionner si l'agent suggère du code Recharts ≥ v3, ça ne marchera pas)
- Hooks globaux : `useState, useEffect, useRef, useMemo, useCallback, useContext, useReducer, createContext, Fragment`
- Composants UI inlinés disponibles :
  - `Card, CardHeader, CardTitle, CardContent`
  - `Button` avec `variant="default|outline|ghost"` + `size="sm|default|lg"`
  - `Input`
  - `Badge` avec `variant="default|success|destructive"` (**pas** `outline`, ne pas l'inventer)
- Composant principal **doit être nommé `App`** (ou `Component` toléré)
- ErrorBoundary englobe le rendu — les erreurs render sont remontées au widget host

**Type `html`** :
- iframe srcdoc avec wrapper Tailwind CDN automatique si pas de `<!DOCTYPE>`
- JS vanilla ES6+, **pas de framework** sauf via CDN explicite
- Console capturée et remontée au widget

**Type `grist`** :
- Document HTML complet **obligatoire** (DOCTYPE + html/head/body)
- `<script src="https://docs.getgrist.com/grist-plugin-api.js">` est **automatiquement remplacé** par le bridge
- Toutes les APIs Grist passent par `postMessage` — asynchrones, latence ~1-5ms
- `grist.ready({ requiredAccess })` obligatoire (`'none' | 'read table' | 'full'`)

**Type `svg`** :
- SVG inline, **pas de wrapper HTML**
- Les `<script>` sont **strippés** ([index.html:1568](index.html#L1568)) — un SVG animé doit utiliser SMIL ou CSS uniquement

**Type `mermaid`** :
- Syntaxe Mermaid pure, **pas de backticks** autour ni de bloc Markdown
- Theme `default`, `securityLevel: 'loose'`

**Type `markdown`** :
- Rendu via `marked.parse` — le HTML inline fonctionne
- Si `IsDoc=true`, l'artefact apparaît dans les chips "Documentation" du panneau IA

#### Contraintes communes (tous types)

- **Iframe sandbox** = `allow-scripts allow-same-origin`
  - Pas de `top.location`, pas de form submit cross-origin
  - `localStorage` partagé avec le widget host (lisible par l'artefact)
- **Origin de l'iframe srcdoc = `null`**
  - `fetch('/api/...')` (relatif) **échoue** — toujours utiliser des URLs absolues
  - Les services tiers doivent renvoyer CORS `Access-Control-Allow-Origin: *` ou `null`
- **Pas de réseau hors CDN/CORS** sauf via `grist.docApi.*` qui passe par le parent
- **Tailwind via CDN** : utilise le mode JIT, certaines classes générées dynamiquement (`bg-${color}-500`) ne fonctionnent pas — préférer des classes explicites

#### Bonnes pratiques de génération

L'agent **doit** :
- Toujours retourner un artefact **complet et autonome** — jamais `// ... rest of code`
- Pour `react` : exporter un composant nommé `App`
- Pour `grist` : appeler `grist.ready({...})` avant tout
- Gérer les états vides / loading / erreur (UI dégradée acceptable)
- Utiliser `mappings` pour les colonnes Grist (avec fallback `record[mappings.X] || record.X`)
- Préférer `<button>` à `<span style="cursor:pointer">` (a11y)
- Préférer `:hover` CSS à `onmouseover="..."` quand possible

L'agent **ne doit jamais** :
- Inventer une API Grist non listée (`setOptions`, `selectedTable`, `window.app`, etc.)
- Émettre des `import` / `export` (Babel standalone ne résout pas les modules — le widget les strip mais autant ne pas en générer)
- Faire un `fetch` relatif
- Renvoyer du code partiel ou tronqué
- Mélanger plusieurs frameworks (jQuery + React, etc.)
- Utiliser un nom de composant React qui ne soit ni `App` ni `Component`

#### Mode auto-correction (préfixe à reconnaître)

Quand le widget envoie un prompt qui **commence par** `Corrige les erreurs
suivantes:`, l'agent doit :
1. Lire le tableau `console` du contexte (5 dernières erreurs)
2. Identifier la cause précise
3. Modifier **uniquement** ce qui est cassé — ne pas refactor le code sain
4. Conserver l'approche / la structure existante
5. Renvoyer le code complet corrigé

L'agent a 3 tentatives max avant que le widget abandonne. S'il ne sait pas
corriger, retourner `{ error: "..." }` plutôt que recommencer depuis zéro.

#### Sécurité

- Le webhook URL et l'API key sont stockés **en clair dans le `localStorage`** du widget — lisibles par tout artefact rendu (sandbox `same-origin`). Acceptable mono-utilisateur, à documenter pour multi-tenants.
- Le screenshot capture le DOM rendu — peut envoyer des données Grist sensibles. Désactiver par défaut sur des données confidentielles.
- L'agent doit traiter chaque requête de manière isolée — ne pas conserver de state qui mélangerait les utilisateurs (le `apiKey` envoyé identifie l'instance, pas la requête).

### Trois patterns d'agent

#### Pattern A — Proxy minimal (recommandé pour démarrer)

Un endpoint qui appelle Claude (ou OpenAI) et renvoie un JSON Artefactory.
Implémentable en n8n en 5 nodes ou en ~30 lignes de Node.

> **Template de system prompt prêt à l'emploi** :
> [AGENT_SYSTEM_PROMPT.md](AGENT_SYSTEM_PROMPT.md) contient un prompt système
> complet, copiable, qui fait respecter à l'agent toutes les contraintes du
> widget (APIs Grist disponibles, env React, mode auto-correction, anti-patterns).
> Substituer `{{MODE}}`, `{{DOCUMENTATION}}`, `{{GRIST_SCHEMA}}` côté ton webhook.

**Exemple Node.js / Cloudflare Worker (Anthropic SDK)** :

```js
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req) {
  const body = await req.json();

  const sysPrompt = [
    `Tu es un assistant pour Artefactory, un IDE Grist.`,
    `Type d'artefact à produire : ${body.mode}.`,
    body.documentation?.length
      ? `Documentation contextuelle :\n${body.documentation.map(d => `## ${d.name}\n${d.content}`).join("\n\n")}`
      : "",
    body.gristSchema
      ? `Schéma Grist disponible :\n${JSON.stringify(body.gristSchema, null, 2)}`
      : "",
    `Contraintes de réponse :`,
    `- UN SEUL bloc de code dans une code-fence \`\`\`${body.mode}\``,
    `- Pas d'import / export (Babel standalone ne résout pas les modules)`,
    `- Pour React : exporter un composant nommé "App"`,
    `- Pour Grist : conserver l'appel à grist.ready({ requiredAccess: ... })`
  ].filter(Boolean).join("\n\n");

  const userMsg = [
    `Code actuel (${body.codeContext}) :`,
    "```",
    body.code,
    "```",
    "",
    body.console?.length ? `Erreurs console :\n${body.console.join("\n")}\n` : "",
    body.prompt
  ].join("\n");

  const reply = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: sysPrompt,
    messages: [
      ...(body.conversation || []).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content
      })),
      { role: "user", content: userMsg }
    ]
  });

  const text = reply.content[0].text;
  const codeMatch = text.match(/```(?:\w+)?\n([\s\S]*?)```/);

  return Response.json({
    code:    codeMatch?.[1]?.trim(),
    message: text.replace(/```[\s\S]*?```/g, "").trim() || "Code généré"
  });
}
```

**Configuration côté Artefactory** :
- Webhook URL : l'URL publique de ton endpoint
- API Key : un secret arbitraire que ton endpoint vérifiera (header
  `Authorization: Bearer <secret>`)

**Configuration n8n équivalente** :
1. Node **Webhook** (POST, response mode "When last node finishes")
2. Node **HTTP Request** ou **Anthropic** appelant l'API Claude/GPT avec le
   prompt système ci-dessus
3. Node **Code** qui parse la code-fence
4. Node **Respond to Webhook** avec `{ code, message }`

#### Pattern B — Agent outillé (tool use)

Si tu veux des modifications fines (replace-lines, insert-at-line), tu peux
laisser Claude appeler des tools structurés et **post-traiter côté webhook**
pour reconstruire un `code` complet à renvoyer. Le widget actuel ne supporte
pas les patches partiels — il applique soit tout, soit la sélection.

Évolution propre possible : étendre `handleAIResponse` ([index.html](index.html))
pour accepter un format `operations: [{ type: "replace", from, to, code }]`.
Pas en place aujourd'hui.

#### Pattern C — Agent local + MCP Grist

Pour un agent qui peut **lire d'autres tables** sans passer par le widget
(bypassant `gristSchema`), faire tourner Claude Agent SDK + un serveur MCP
Grist en local, exposer un endpoint HTTP devant. Plus puissant mais demande de
l'orchestration. Hors scope d'un branchement minimal.

### Recommandation pour démarrer

1. Déployer le **Pattern A** sur Cloudflare Workers / Vercel / n8n.
2. Coller l'URL dans le panneau IA, configurer un Bearer token côté webhook.
3. Créer un artefact Markdown `Conventions` avec `IsDoc=true` qui décrit les
   règles maison (style React, conventions Grist, etc.).
4. Le sélectionner avant chaque requête IA — il sera joint comme contexte.
5. Tester avec un prompt simple ("Crée un compteur") puis itérer sur le
   prompt système du webhook.

Une fois stable, voir si tu veux étendre vers le Pattern B (tool use) ou C
(MCP) selon les besoins.

## Sécurité

- **Stocker la clé API webhook côté serveur**, pas dans Grist. Le champ
  `apiKey` du widget envoie un `Authorization: Bearer` à TON webhook — c'est
  toi qui décides quoi en faire derrière.
- **Toujours protéger le webhook** (Bearer token, IP allowlist, ou les deux).
  Sans protection, n'importe qui qui voit un screenshot du widget avec l'URL
  peut consommer ton quota.
- **Le sandbox iframe est `allow-scripts allow-same-origin`** : un artefact
  malveillant peut accéder au localStorage du widget host (donc lire le token
  configuré). Ne pas charger d'artefacts non audités dans un environnement
  partagé.
- **Le screenshot capture le DOM rendu** : si l'artefact affiche des données
  Grist sensibles, elles partent dans la requête. Désactiver le bouton 📸 par
  défaut sur des données confidentielles.

## Limites connues

- Pas de versioning des artefacts (chaque save écrase).
- Pas de partage entre documents Grist (chaque doc a sa propre table
  `Artefacts`).
- Pas de support iframe imbriquée (un artefact ne peut pas embarquer un autre
  artefact). Cf. [CLAUDE.md](CLAUDE.md) pour les patterns à reprendre de la
  v12 historique si on veut ré-introduire la composition.
- Pas de streaming de la réponse IA.
- L'historique conversationnel envoyé au webhook est tronqué à 10 messages ×
  500 caractères.
