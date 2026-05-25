# Convention « Données géo dans Grist » (v0)

Contrat **partagé** entre l'importeur **qgis2grist** (écrit) et le canva **Atlas**
(lit / rend / édite). But : faire de Grist + Atlas un canva universel pour cartes
et projets QGIS, de façon **standardisée et réversible**.

> Statut : **spécification, non encore implémentée**. Sert de référence avant tout
> développement. À faire évoluer ici (et pas dans le code en silo).

---

## 1. Principe

- Une **couche** = une *vue* sur une **source**. Deux natures de source :
  - `kind: 'blob'` — la couche porte son GeoJSON (dessins, imports rapides). Atlas
    fonctionne **tel quel**, sans Grist.
  - `kind: 'table'` — la couche est **liée** à une table « 1 ligne = 1 objet ».
    Atlas construit la FeatureCollection **à la volée** depuis la table (la jointure
    vit dans le widget, voir §6), édite **ligne par ligne**, et peut garder un blob
    en **cache** (standalone / perf / snapshot).
- La donnée géo stockée est toujours en **WGS84 (EPSG:4326)**.

---

## 2. Table de données « 1 ligne = 1 objet »

Une table par couche. Une ligne = un objet. Colonnes :

| Colonne | Rôle | Statut qgis2grist |
|---|---|---|
| `geometry_json` | géométrie **GeoJSON (string)**, WGS84 | ✅ écrit |
| `latitude` / `longitude` | commodité pour les points | ✅ écrit |
| *attributs* (typés) | données ; `Choice` (ValueMap), `Ref`/`RefList` (relations) | ✅ écrit |
| `fill_color` | couleur **par objet** (hex), dérivée du renderer QGIS | ✅ écrit |
| `stroke_color`, `size`/`radius`, `opacity` | style par objet (optionnel) | ➕ à ajouter |
| `height`, `elevation`, `model_id` | 3D : extrusion / altitude / modèle (optionnel) | ➕ |
| `label` *(ou champ désigné)* | étiquette | ➕ |

**Détection de la géométrie** (ordre) : `geometry_json` → `geometry` → `geom` →
`wkt` (parse) → paire `latitude`+`longitude` (alias `lat`/`lng`/`lon`).

**Identité** : le **rowId Grist** est la clé stable (sélection, édition, write-back).

---

## 3. Registre de couches

Table décrivant **ce qui est une couche géo et comment l'afficher**. C'est la
généralisation de `Maquette_Layers`. Atlas n'affiche **que les couches déclarées
ici** ; les autres tables géo du document sont seulement *proposées « à lier »*.

Une ligne par couche :

| Champ | Rôle |
|---|---|
| `name` | nom de la couche |
| `kind` | `'blob'` \| `'table'` |
| `sourceTable` | **id de la table** liée (texte ; résolu par Atlas — pas un Ref Grist, cf. §7) |
| `geometryColumn` | nom de la colonne géométrie de la source |
| `geomType` | `Point` \| `Line` \| `Polygon` (+ Multi) |
| `geojson` | blob FeatureCollection — source si `kind:'blob'`, **cache** si `'table'` |
| `styleJSON` | style portable (cf. §4) |
| `color`, `visible`, `order`, `group` | défaut couleur, visibilité, ordre, groupe (arbre QGIS) |

---

## 4. Style portable (`styleJSON`)

Superset commun **QGIS QML ↔ symbo Atlas**. Forme :

```json
{
  "mode": "single | categorized | graduated | model",
  "field": "<champ pour categorized/graduated>",
  "color": "#RRGGBB",                         // single
  "categories": [{ "value": "...", "color": "#...", "modelId": "..." }],
  "ranges":     [{ "lower": 0, "upper": 10, "color": "#..." }],
  "size":   { "mode": "fixed|graduated", "value": 8, "field": "...", "range": [0.5,3] },
  "height": { "field": "...", "value": 12 },  // extrusion / 3D
  "model":  { "modelId": "...", "field": "..." },
  "label":  { "field": "...", "enabled": true }
}
```

**Précédence** (du plus fort au plus faible) :
`styleJSON` de la couche (règle) **>** colonnes de style par objet (`fill_color`…,
le « cuit » QGIS) **>** défaut de couche.
→ Le rendu QGIS est fidèle par défaut, et reste modifiable dans Atlas.

**Mapping QML → styleJSON** (déjà parsé par qgis2grist) :
`singleSymbol → single`, `categorizedSymbol → categorized`,
`graduatedSymbol → graduated`.

---

## 5. Conversions réversibles (2 commandes)

- **Descendant — couche → table 1-1** (« Exploser en table ») : Atlas lit le blob,
  crée la table standard (§2), bascule la couche en `kind:'table'` liée.
- **Montant — table 1-1 → couche** (« Lier une table ») : l'utilisateur choisit une
  table géo ; Atlas crée la ligne de registre (binding + style détecté) et rend.

Les deux partagent ce contrat → import qgis2grist et dessins Atlas convergent.

---

## 6. Jointure & rafraîchissement

- La **jointure vit dans Atlas (JS)** : il lit n'importe quelle table via `docApi`
  et construit la FeatureCollection. (Grist ne permet pas une formule/Ref générique
  vers une table variable — cf. §7.)
- Édition `kind:'table'` → **write-back par ligne** dans les colonnes de §2.
- Rafraîchissement des tables liées : **au focus / retour d'onglet** (léger), pas de
  temps réel multi-tables.

---

## 7. Contraintes Grist (à respecter)

- Réactivité (`grist.onRecords`) **uniquement** sur la table mappée du widget → les
  autres tables liées se lisent via `docApi.fetchTable` (one-shot) + refresh §6.
- Une colonne `Ref`/`RefList` cible **une table fixe** → le lien couche→table est
  stocké en **texte** (`sourceTable`) et résolu par Atlas.
- `requiredAccess: 'full'` requis (lecture multi-tables + création/écriture).

---

## 8. Automatismes

**Ligne de sécurité** : *automatique* pour **lire / afficher / dériver / proposer** ;
*explicite (ou réversible + confirmé)* pour **écrire / créer / modifier** la donnée
Grist (création de table, write-back en masse, reprojection).

Automatique :
- montage des couches **déclarées au registre** ; détection des autres tables géo →
  proposées « à lier » ;
- détection colonne géométrie, type géo, champ étiquette ;
- **auto-fit** caméra sur l'emprise des données ;
- application du style « cuit » par objet ; sinon **symbo par défaut** (catégorisé sur
  texte peu varié, gradué sur numérique, palette auto) ;
- **contrôles auto-suggérés** depuis les champs (date → curseur temps/animation,
  numérique → plage, catégoriel → sélecteur), bornes/options déduites des données ;
- pose 3D sur le relief + re-calage (tuiles DEM, toggle terrain, fond, redimension) ;
- repli : modèle absent → cercle de hit ; DEM illisible → tuile plate.

Explicite / confirmé :
- création du registre, explosion blob→table, liaison de table ;
- write-back vers Grist ;
- **CRS non-WGS84** : reprojection best-effort si l'info de projection est dispo,
  **sinon alerte** (renvoi vers qgis2grist).

---

## 9. Hors-périmètre v0 (à spécifier plus tard)

- Schéma précis du **rack de contrôles** déclaratif (sérialisation).
- Sync **sélection inter-widget** (clic carte ↔ curseur de ligne).
- Groupes/arbre de couches avancé, multi-géométrie.
