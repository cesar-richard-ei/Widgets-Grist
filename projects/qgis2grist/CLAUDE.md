# Projet : qgis2grist

Widget Grist d'import de projets QGIS (qgis2web HTML/ZIP, .qgz/.qgs, GeoPackage,
paquets QField). Crée le schéma de tables Grist et y peuple les données ; rend
ensuite une carte Leaflet live-synchro.

## Contexte

L'objectif n'est pas d'afficher une carte par-dessus QGIS — c'est de **rendre
les données QGIS exploitables nativement dans Grist** : colonnes typées, choix,
relations, libellés humains. La carte est un sous-produit pour visualiser le
résultat.

## Architecture

### Machine d'états

```
drop → reading → preview → importing → map ↔ original
                                             ↓
                                          error
```

État courant dans `currentState`. Transitions via `setState(name)`.

### Pipeline de parsing

| Format | Entry point | Sortie commune |
|---|---|---|
| qgis2web HTML | `parseQgis2webHtml(html)` | `[layer, ...]` |
| qgis2web ZIP | `parseQgis2webZip(zip)` | idem |
| QGZ | `parseQgzFile(ab, parentZip, name)` | idem (delègue à `parseQgsXml`) |
| GeoPackage standalone | `parseGpkgFile(ab)` | idem |
| GeoJSON dans ZIP | `parseGeojsonFiles(zip, names)` | idem |

`layer` = `{name, displayName, geomType, fields, features, featureCount, hasData,
datasource, style, _layerId?}`.

`fields[]` = `{name, _rawKey, label, qType, gType, widgetOptions?, description?,
_valueMap?, _refTargetTable?, _refTargetField?, _externalResource?}`.

### Pipeline d'import Grist

`startImport()` :
1. Tri topologique `topoSortByRefs` — parents avant enfants pour les Refs.
2. Pour chaque couche, dans l'ordre :
   - `listTables()` → générer un nom unique.
   - `AddTable` avec `label`, `widgetOptions`, `description`.
   - Boucle `BulkAddRecord` par lots (100 si Polygon/Line, 500 si Point).
   - Capture des nouveaux rowIds via `result.retValues[0]`.
   - Si la couche est référencée par d'autres : indexer `valeur → rowId`
     dans `parentMaps[tableName][refField]`.
3. Lors de l'insertion d'une couche enfant, transformer chaque FK en rowId
   via `parentMaps`.

### Métadonnées de colonne (passes 1b + 2)

| Source QGIS | → Grist |
|---|---|
| `<aliases><alias>` | `label` |
| `<editWidget type="ValueMap">` | `Choice` + `widgetOptions.choices` + `_valueMap` (transform à l'import) |
| `<editWidget type="Range">` | `Numeric` (ou `Int` si Step entier sans Precision) |
| `<editWidget type="CheckBox">` | `Bool` |
| `<editWidget type="DateTime">` | `Date` ou `DateTime` selon `field_format` |
| `<editWidget type="ValueRelation">` | `Ref:` ou `RefList:` (passe 3) |
| `<editWidget type="ExternalResource">` | marqueur `_externalResource` (Attachments à venir) |
| `<relations><relation>` | `Ref:<TargetTable>` sur le champ référençant |
| GPKG `gpkg_data_columns.title/description` | `label`/`description` |
| GPKG `gpkg_data_column_constraints type='enum'` | `Choice` |
| GPKG `qgis_projects.xml` | `.qgs` complet → aliases + editWidgets si pas déjà lus |

### Persistance

Une table `QgisWidgets` (auto-créée) stocke un JSON de config par import. Permet
restauration au prochain chargement du widget. Schéma : `widget_name`,
`source_file`, `config_json`, `created_at`. Le `config_json` contient meta
BigQgisMCP, fields enrichis, refs, styles.

Pas de `setOption()` ici : on veut que la config survive à un duplicata du
document (la table fait partie du document, l'option non).

## Conventions spécifiques

### Géométrie

- Point : colonnes `latitude`, `longitude` (Numeric).
- Line / Polygon : colonnes `geometry_json` (Text, JSON GeoJSON arrondi à 5
  décimales ≈ 1 m), `centroid_lat`, `centroid_lon`.
- Pas de `Ref:Geometry` Grist — la géométrie est sérialisée.

### Couleur par feature

Colonne auto `fill_color` (Text) calculée à l'import via le QML / les fonctions
qgis2web. Permet à n'importe quelle vue Grist de récupérer la couleur sans
re-parser le style. **Inconvénient** : si l'utilisateur édite la valeur de
classification, `fill_color` n'est pas recalculé. À documenter pour l'utilisateur.

### `_rawKey` vs `label` vs `name`

- `_rawKey` = clé brute dans les properties GeoJSON (ex: `ht_max`).
- `label` = libellé humain affiché (alias QGIS / `gpkg_data_columns.title` /
  ou `_rawKey` à défaut).
- `name` = id Grist sanitisé (ex: `ht_max`, ou `Hauteur_d_eau` si caractères
  spéciaux).

`flattenGeoJsonFeatures` cherche `props[_rawKey]` en priorité.
`makeMarkerColorFn` (style) cherche dans cet ordre : `_rawKey`, `label`, `name`.

## État actuel

Fait :
- Parsers qgis2web HTML/ZIP, QGZ/QGS, GPKG (avec sql.js + WKB pur JS), GeoJSON.
- Reprojection EPSG:3857 native, autres CRS via proj4js on-demand.
- QML (categorized/graduated/single) extraction couleurs.
- BigQgisMCP : titre, slider, palettes flood/building, légende dynamique.
- Import : labels, widgetOptions Choice, relations Ref:, FK → rowId, GPKG
  metadata.
- Carte Leaflet live-synchro (polling Grist 5 s) + bandeau restauration.

À faire / limites connues :
- **ExternalResource → Attachments** : marqueur posé (`_externalResource`) mais
  upload des fichiers depuis paquet QField pas encore implémenté. Nécessite
  `grist.docApi.uploadAttachment(blob)` + reconstruction du chemin relatif.
- **QGIS 2.x** : `<edittypes>` legacy détectés mais leur format `widgetv2config`
  (avec `<value key= value=>`) n'est pas parsé — ValueMap dégradé en Text.
- **Polling 5 s sans backoff** : sur grosse table c'est coûteux. Pas de pause
  quand l'onglet est en arrière-plan.
- **`adaptHtmlForGrist` / `renderAsWidget`** : ~360 lignes mortes, à supprimer
  ou réintégrer.

## Points d'attention

### `BulkAddRecord` retVal capture

`result.retValues[0]` contient le tableau des nouveaux rowIds. Cette capture
est essentielle pour les Refs ; sans elle on ne peut pas indexer les parents.

### Tri topologique

Cycles ignorés via `visiting`/`visited`. Si A référence B et B référence A,
les deux sont émis dans l'ordre de découverte ; les Refs cycliques ne seront
pas résolues correctement (acceptable, c'est un cas exotique en QGIS).

### Renommage de table en cas de collision

`tableNameRemap[layer.name] = tableName` enregistre la correspondance avant
`AddTable`. `resolveRefType` traduit ensuite `Ref:OldName` → `Ref:NewName` à
la création des colonnes Refs des enfants.

### `_valueMap` et le label Grist

Les valeurs catégorisées QGIS sont transformées en LABELS Choice à l'import.
Si l'utilisateur ajoute une nouvelle valeur dans Grist qui n'existe pas dans
`_valueMap`, elle sera stockée telle quelle. C'est OK : Grist accepte les
valeurs hors-`choices` (elles sont marquées invalides en UI mais persistées).

## Patterns réutilisables

- `parseOptionTree(el)` : parser récursif de `<Option type="Map|List|...">`,
  format de sérialisation `QgsXmlUtils::writeVariant`. Réutilisable pour
  d'autres outils QGIS web.
- `WkbReader` : parser WKB/EWKB/ISO Z·M·ZM pur JS, ~50 lignes.
- `topoSortByRefs(layers)` : tri topologique générique sur graphes de Refs.

## Tests manuels

Pas de suite automatisée. Pour valider une modif, tester avec :
1. Un export `qgis2web` ZIP simple (couche unique Polygon).
2. Un projet `.qgz` QField avec relations 1-N et ValueMap.
3. Un GeoPackage standalone avec `gpkg_data_columns` et `gpkg_data_column_constraints`.
4. Un projet BigQgisMCP (HTML inondation avec slider).

Vérifier dans Grist :
- Labels humains présents sur les colonnes.
- `Choice` avec choix valides pour ValueMap.
- `Ref:Parent` cliquable sur les FK (le widget Grist doit afficher la ligne parent).
- Restauration après reload du widget.
