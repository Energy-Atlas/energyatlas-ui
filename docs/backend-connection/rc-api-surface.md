# RC `EnergyAtlasWeb` HTTP API surface

Date: 2026-11-08. Reference `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator` at
`feature/archetype-library-schedule-registry` = `main26` = `7464c140`, read only (`git --no-optional-locks`, file
reads). Nothing was built, run, or copied. Paths are relative to that repository; "L" is a line number. Response
shapes are read from code, not observed at runtime. Part of the [backend connection evidence index](README.md).

## 0. Applies to every endpoint

- Attribute routing only: every action has an absolute route (`[HttpGet("/api/...")]`); no class prefixes, no minimal
  APIs. Controllers mapped at `EnergyAtlasWeb/WebAppFactory.cs` L180.
- Hubs: `/jobHub` (L181; client invokes `JoinJob(jobId)`, receives `jobEvent`, `jobProgress`;
  `EnergyAtlasWeb/Hubs/JobHub.cs`) and `/workflowProgressHub` (L182; broadcasts `workflowProgress`;
  `Hubs/WorkflowProgressHub.cs`).
- JSON: Newtonsoft with `StringEnumConverter` (WebAppFactory L76-80), enums as names. `Project.json` on disk uses
  camelCase enums and keeps dictionary keys (`Models/ProjectData.cs` L98-111). Whether MVC camelCases dictionary keys
  in responses is unconfirmed.
- Many POST actions read `Request.Body` into a `JObject` by hand, so Swagger shows no body schema for them.
- No CORS, no authentication (grep for `Cors`, `UseAuth`, `Authorize`: none).
- Ports: HTTPS 7200, HTTP 5094, with a sweep (`Program.cs` L8-53, `Properties/launchSettings.json`). Upload limit
  2 GB (WebAppFactory L84-88).
- Error body `{success:false, message, code}`, sometimes plus `error` (`Runtime/ApiErrors.cs`); model-binding
  failures 400 `invalid_request` with `title/status/errors/traceId` (L49-64); older routes return `{error}` or a string.
- `ProjectEditFilter` (`Runtime/ProjectEditGate.cs` L98-184): listed mutation routes (L111-141) and run routes
  (L147-148) get 409 `run_in_progress` `{jobId, kind}` while a simulation or calibration run holds the gate; 409
  `project_changed` if the project was swapped while a request waited (L170).
- `JobStatus {Created, Running, Completed, Failed, Cancelled}` (`Runtime/JobRuntimeState.cs` L9).
- `GET /api/config` returns `mapboxToken` from `appsettings.json` `Mapbox:Token` (`Controllers/GUIJobRunnerController.cs`
  L61-77). The value is not reproduced here.

## 1. Controllers

24 files, 23 classes in `EnergyAtlasWeb/Controllers/` (`SimulationResultsController.cs` is part of the partial class
`SimulationController`).

### 1.1 Project and workflow: `ProjectController.cs`

| Verb | Route | Input | Output / codes |
| --- | --- | --- | --- |
| GET | /api/project/editStatus (L54) | – | `{blocked, reason, code?, jobId, kind}` |
| GET | /api/project (L70) | – | `{loaded:false}` or `{loaded:true, project: ProjectData}` |
| GET | /api/project/workflow (L80) | – | `{loaded, states:{itemId: WorkflowItemState}}` |
| POST | /api/project/create (L92) | `CreateProjectRequest {name?, folder, overwrite}` (L548) | `{success, project}`; 400 `missing_folder`; 409 `project_exists` |
| POST | /api/project/open (L136) | `OpenProjectRequest {folder?, projectJsonPath?}` (L560) | `{success, project, recovery}`; 400; 404 `project_not_found` |
| POST | /api/project/save (L232) | – | `{success}`; 400 `no_project`; 500 on IO error |
| POST | /api/project/close (L361) | – | `{success}` (saves first) |
| POST | /api/project/workflow/{itemId}/status (L247) | `{status}` | `{success, state}` |
| POST | /api/project/workflow/{itemId}/data (L259) | `Dictionary<string,object>` | `{success, state}` (merged into `userData`) |
| POST | /api/project/workflow/{itemId}/persist-files (L279) | `{footprintSource, parcelSources[]}` | `{success, …}`; only for `geospatial-data-upload-fusion` |
| POST | /api/project/archetypes/load (L660) | `{folders[]}` (server paths) | `{success, summary, errors, nextPath}`; 400 `folder_not_found`, `unsupported_archetype_format`, `invalid_archetype`, `invalid_json` |
| GET | /api/project/archetypes/filterOptions (L757) | – | `{climates[], buildingTypes[], vintages[]}` |
| GET | /api/project/archetypes/list (L768) | `?category` | `[{guid, name, climates, buildingTypes, vintages}]` |
| GET | /api/project/archetypes/detail (L789) | `?category&guid` | part JSON; 404 |
| POST | /api/project/archetypes/edit (L813) | `{category, guid, part}` | `{success, guid, name, category}` |
| DELETE | /api/project/archetypes/delete (L846) | `?category&guid` | `{success}`; 403 built-in; 404 |
| POST | /api/project/archetypes/duplicate (L877) | `{category, guid, newName?, newSuffix}` | `{success, error, guid, name, category}` |
| POST | /api/project/measures/load (L896) | `{folders[]}` | `{success, summary, nextPath}` |
| GET | /api/project/measures/list (L990) | `?category` (7 ids, L890) | `[{entryName, name}]` |
| GET | /api/project/measures/defaults (L1003), /detail (L1023) | `?category` (`&entryName`) | measure JSON; 404 |
| POST | /api/project/measures/save (L1054) | `MeasureSaveRequest {categoryId, entryName, isNew, measureJson}` (L1405) | `{success, entryName, categoryId}` |
| DELETE | /api/project/measures/delete (L1109) | `?category&entryName` | `{success}`; 404 |

Workflow item ids: `WorkflowDefinition.AllItemIds` (L1417-1446), 20 ids in 5 groups (listed in
[rc-runtime-hosting.md](rc-runtime-hosting.md#4-project-persistence)).

### 1.2 Archetype imports: `ProjectArchetypeImportsController.cs`

`POST /api/project/archetypes/upload` (L10; multipart `.json`, `?category`; `{success, documentCount, parts[]}`; 409
if the project changed), `GET /api/project/archetypes/samples` (L39), `POST /api/project/archetypes/import` (L56;
`{category, sampleEntryName?, url?}`).

### 1.3 Data fusion: `FusionController.cs`

| Verb | Route | Input | Output |
| --- | --- | --- | --- |
| POST | /api/project/fusion/run (L32) | none (reads workflow `userData`) | `{success, entryName:"WorkingFootprints", featureCount, fileSizeMb, fusionReport?}` |
| POST | /api/project/fusion/replaceArtifact (L281) | multipart GeoJSON | `{success, entryName, featureCount, fileSizeMb}` |
| POST | /api/project/fusion/previewUpload (L379) | multipart GeoJSON (reprojected to WGS84) | `{success, entryName}` |
| POST | /api/project/fusion/previewFromPath (L443) | `{path}` (server path) | `{success, entryName}` |
| GET | /api/project/fusion/artifact (L496) | – | `{loaded, entryName, featureCount, fileName, downloadLink}` |
| GET | /api/project/schemaMatch/artifact (L700) | – | same shape |
| POST | /api/project/schemaMatch/replaceArtifact (L743) | multipart GeoJSON | `{success, …}` |

### 1.4 Schema matching: `SchemaMatchingController.cs`

`GET /api/schemaMatching/targetFields` (L134; `SchemaTargetFieldInfo[]`, L840), `POST autoMatch` (L208;
`{entryName?, sourceFields?}`), `POST applyMapping` (L304; `{entryName, mappings[{source,target,transform?}]}` →
GeoJSON), `POST saveToDataHub` (L329; file download), `POST uploadGeoJson` (L381; multipart), `GET loadRules` (L462;
`{loaded, mappings[]}`), `POST saveRules` (L496; `{mappings[{target,source,tier,transform}]}`),
`POST /api/project/schemaMatch/complete` (L595; optional `{mappings}` → `{success, nextPath, entryName, featureCount,
appliedCount, warnings}`; 400 `no_project`, `working_collection_incomplete`).

### 1.5 Geometric preprocessing: `GeometricPreprocessingController.cs`

`POST /api/project/geometricPreprocessing/run` (L36; `{success, nextPath, entryName, featureCount, areaCount,
perimeterCount, areaOverrides, perimeterOverrides}`), `GET …/artifact` (L151), `POST …/replaceArtifact` (L191).

### 1.6 Template (archetype) assignment: `TemplateAssignmentController.cs`

`GET /api/samples/ithacaBuildings` (L52); `GET /api/templateAssignment/archetypes/{constructions|systems|spaceloads|
externalloads}` (L63-117; `ArchetypePartDto {guid,name}`, L2189); `POST evaluate` (L136; `entryName` plus
`templateAssignments` or `rules/defaultRules/settings` as `RulesetRequest`, L2136 → `{assignments, statistics,
warnings, idEsl}`); `POST templated` (L427; `.geojson` file, header `X-DataHub-EntryName`); `POST complete` (L667;
`{success, nextPath, entryName:"SimulationReadyFootprints", featureCount, assignedCount, warnings}`);
`GET /api/project/archetypeAssignment/artifact` (L954), `POST …/replaceArtifact` (L989); `POST export` (L1095),
`POST import` (L1193; multipart), `GET loadRules` (L1406; `{loaded, rules, defaultRules, settings}`),
`GET defaultRules` (L1444; `?climateZone`).

### 1.7 Schedules and calendar

`ScheduleRegistryController.cs` (all 400 `no_project` without a project): `GET /api/schedules`
(L45; `?scope=project|library&nameContains`), `GET /api/schedules/{scheduleId:guid}` (L82; `?calendarYear`; 404
`schedule_not_found`), `POST /api/schedules/validate` (L133; `{success, valid, kind, contentScheduleId?, hours,
stats{min,max,loadHours}}`). No create or update route was found. `CalendarController.cs`: `GET /api/calendar/{year}`
(L17; 1900-2100).

### 1.8 Zones and zone simulation: `ZoneCalibrationController.cs`

Zones live in memory only (L14-19); contract doc `EnergyAtlasWeb/Planning/CalibrationAPIs.md`. `POST /api/zones/extract`
(L56), `GET /api/zones` (L109; paged), `GET /api/zones/{zoneId}` (L143; `DescribeZone` around L1257: `geometry` holds
`floorArea`, `roomVolume`, and wall, floor, and roof **face counts**, not polygons), `GET …/definition` (L153),
`GET /api/buildings/{buildingId}/zones` (L167), `GET /api/zones/definitions` (L181), `POST importDefinitions` (L213),
`POST definitions/export` (L344), `PATCH /api/zones/{zoneId}` (L385), `POST batchPatch` (L415), zone schedules GET/PUT
(L465-549), `POST /api/zoneSimulation/preflight` (L600), `POST run` (L634; 409 `run_in_progress`, `session_closed`),
`runFromDefinitions` and `runStandalone` (410, deprecated), `POST batchRun` (L849), `GET job/{jobId}` (L902),
`DELETE job/{jobId}` (L947; 409 `job_running`).

### 1.9 Building calibration: `BuildingCalibrationController.cs`

`POST /api/calibration/evaluate` (L71; candidates → `{calibrationRunId, jobId}`; 409 `inputs_changed`, `run_closed`,
`job_running`), `POST run` (L209; `{calibrationRunId, validation, featureCount, calendarYear, calendarSource}`),
`GET runs` (L326), `GET job/{jobId}` (L366), `GET job/{jobId}/results/{candidateId}` (L409), `DELETE job/{jobId}`
(L464), `DELETE run/{runId}` (L484), `POST job/{jobId}/cancel` (L504), `POST accept` (L512; `{calibrationRunId,
selections[{jobId, candidateId}]}`; writes `ProjectData.CalibratedBuildings`), `DELETE accepted/{featureId}` (L568).

### 1.10 Population simulation and results: `SimulationController.cs`, `SimulationResultsController.cs`

| Verb | Route | Notes |
| --- | --- | --- |
| POST | /api/simulation/preflight (L88) | `SimulationPreflightResult`; 400 `entry_not_found`, `entry_not_loaded`, `feature_source_required`, `invalid_feature_collection` |
| POST | /api/simulation/run (L122) | `{weatherEntryName, entryName \| featureCollection, defaults, scenarios[], localIncentives, zoning, fuelData, options{executionMode, calendarYear, degParallelism, chunkSize, reportHourly, captureZoneHourly}}` → `{success, jobId, calendarYear, calendarSource}`; 400 codes; 409 |
| GET | /api/simulation/job/{jobId} (L242) | `?maxSignals` → `{success, jobId, jobName, status, error, startedAt, finishedAt, result, signals[]}`; 404 `unknown_job` |
| GET / POST | /api/project/simulation/baselineArtifact (L415), replaceBaselineArtifact (L479) | artifact read and upload |
| GET | /api/simulation/job/{jobId}/database (Results L147) | `results.duckdb`, `application/octet-stream` |
| POST | /api/simulation/job/{jobId}/cancel (L172) | 202, 200, 409 `job_terminal`, 404 |
| GET | /api/project/simulation/resultArtifact (L197) | `{loaded, jobId, result}` |
| POST | /api/simulation/job/{jobId}/export (L210) | selection: one of `baseline:true`, `assignments[{buildingKey, versionKey}]`, `penetration{versionKey, fraction, seed}`, plus `failedVersionPolicy` |
| POST | /api/simulation/job/{jobId}/summary (L295) | totals, savings, diagnostics |
| POST | /api/simulation/job/{jobId}/aggregate (L352) | `groupBy`, `resolution` (annual, monthly, hourly), `columns[]`; 400 `row_limit`, `hourly_not_persisted`, `invalid_group_by` |
| GET | /api/simulation/runs (L530) | runs with `servable`, `current` |
| GET | /api/simulation/job/{jobId}/versions (L649), /outcomes (L679) | versions; paged outcomes (max 10,000) |
| POST | /api/simulation/job/{jobId}/buildings (L738) | paged per-building rows |

### 1.11 Scenario designer: `ScenarioDesignerController.cs`

`GET /api/scenarioDesigner/measures/{envelope|heating|cooling|hotwater|plugload|gasequipment|pv}` (L27-82),
`POST evaluate` (L90; `{available, assignments, statistics}` or `{available:false, message, requiredKeys}`),
`POST export` (L258), `POST import` (L287), `POST saveLibrary` (L324), `GET loadLibrary` (L354), `POST saveScenario`
(L386; `SaveScenarioRequest`, L1000), `GET scenarios` (L480), `GET scenarios/{id}` (L507).

### 1.12 Weather: `WeatherController.cs`

`GET listSample` (L20), `GET listEntries` (L68), `POST importSample` (L38), `POST upload` (L86; multipart `.epw`),
`POST loadFromDisk` (L141; `{filePath}`), `GET summary` (L193; `?entryName`).

### 1.13 Shading

`ProjectShadingController.cs`: `POST /api/project/shading/sidecar` (L50; multipart `file` or `{filePath}`; installs
`UserData/Shading/sunlit.duckdb`), `DELETE` same route (L218), `GET /api/project/shading/status` (L243).
`VoxelShadingController.cs`: `POST /api/voxelShading/generateSensors|calculate|voxelize|calculate/preflight|
preview/*` (L174-317), `GET capabilities` (L327), `GET|DELETE job/{jobId}` (L343, L379), `GET result/{jobId}`
(L413); server folders, job ids.

### 1.14 DataHub, sample data, building download

`DataHubController.cs`: a process-global store cleared on create, open, close. `POST /api/dataHub/fetch{FeatureCollection|
…Measure|Csv|JsonString|WeatherEpw}?fileName=` (L31-226), `GET list*Entries` (L239-515; `EntryInfo {name,
fileSizeMB, downloadLink, metadata}`, L1691), import, upload (multipart), `upsertMeasureEntry` (L532-1046), `DELETE
remove*Entry?name=` (L1076-1423), `GET geoData` 501 (L1670). `BuildingDownloaderController.cs`: Overture layers, `POST
fetchRegion` (L153; GeoJSON decoded from remote PMTiles), `getTileMetadata`, `saveToDataHub`.
`GeoDataPreviewController.cs`: `listGeoJsonEntries`, `POST fetchGeoJson`, `GET getFeatureAttributes` (paged),
`GET fetchProjectFile?path=`.

### 1.15 Result viewers

`ResultViewerController.cs`: upload, `GET uploaded/{id}`, `POST censusOverlay` (TIGERweb; 502 upstream).
`CapResultViewerController.cs`: not project-scoped (env or hard-coded paths, L9-12, L325-334); attributes, summary,
tile metadata, `tiles/{z}/{x}/{y}.mvt` and `aggregateTiles/{layer}/{z}/{x}/{y}.mvt` (`application/x-protobuf`),
`featureCollection`.

### 1.16 Jobs and miscellaneous

`JobListController`: `GET /api/jobList`. `JobRouterController`: `POST /api/jobList/{jobName}/start` → `{jobId}`.
`GUIJobRunnerController.cs`: `GET /api/config` (L61), `GET /api/guiJob` (L80), schema, validate, run, result (L94-264),
`POST upload` (L282; `{files[{originalName, tempPath}]}`), downloads (L357, L377), `POST revealInFolder` (L399).

## 2. Main data types

| Concept | Type and path | Main fields |
| --- | --- | --- |
| Project | `ProjectData`, `EnergyAtlasWeb/Models/ProjectData.cs` L36 | `formatVersion` 2, `projectName`, `projectFolder`, `createdUtc`, `modifiedUtc`, `workflowStates{}`, `zoneDefinitions[]`, `calibratedBuildings{}` |
| Workflow state | `WorkflowItemState` (L22), `WorkflowItemStatus` (L13) | `id`, `status` (NotStarted, Complete, Running, Skipped, Future), free-form `userData` (artifact keys `dataHubEntry`, `featureCount`, `fileName`, `scratchPath`) |
| Buildings | GeoJSON FeatureCollection; attribute names in `EnergyAtlasLib/IO/GeoJsonIO.cs` `Inputs` (L69-192) | e.g. `ID_ESL`, `ubid`, `SelectForSim_ESL`, `BuildingType_ESL`, `YearBuilt_ESL`, `Area_SQM_ESL`, `BldgHeight_M_ESL`, `Floors_ESL`, `*ArchetypeGuid`, `*ArchetypeName` |
| Archetype parts | `ArchetypePartDto`; full part via `EnergyAtlasCore/Model/Schedules/ScheduleLibraryJson.cs` L41 | categories from `ProjectArchetypeManifest.Categories` |
| Assignment rules | `RulesetRequest`, `RuleDto`, `ConditionDto`, `SettingsDto` (TemplateAssignmentController.cs L2136-2186) | `id`, `type` (builder, custom), `logic`, `priority`, `enabled`, `conditions[{field, source, operator, value}]`, `assign{Construction,Systems,Spaceloads,ExternalLoads}Guid`, `formula` |
| Schedules | `ScheduleRecipe` (`EnergyAtlasCore/Model/Schedules/ScheduleRecipe.cs`); describe JSON in `EnergyAtlasLib/Zones/ZoneScheduleUtil.cs` L116-239 | `name`, `isUnspecified`, `activeValue`, `dst*`, `daySchedules`, `dayScheduleIndices`, `hourly`, `calendarHourly` |
| Measures and scenarios | `MeasureBase` (`EnergyAtlasCore/Scenarios/MeasureBase.cs`), `EnergyAtlasLib/Scenarios/AllMeasures.cs`, `Scenario` (`EnergyAtlasLib/Scenarios/Scenario.cs`); `MeasureRuleDto`, `SaveScenarioRequest` (ScenarioDesignerController.cs L946-1063) | – |
| Preflight | `SimulationPreflightResult` (`EnergyAtlasWeb/Services/Simulation/`) | `succeeded`, counts, `errors`, `warnings`, `information`, `defaultsApplied` (each `featureId, field, code, severity, message, originalValue, effectiveValue`) |
| Calibration | `BuildingCalibrationDto` (`EnergyAtlasLib/Calibration/BuildingCalibrationDto.cs` L16), `BuildingCalibrationResult` (`BuildingCalibrationEvaluator.cs` L18) | candidate parameters; summary and hourly results |
| Jobs | `JobRuntimeState` | see [rc-runtime-hosting.md](rc-runtime-hosting.md#3-jobs-and-signalr) |

## 3. Project scope

No project id anywhere (grep for `projectId|ProjectId|SessionId` in Controllers and Runtime: none). One
process-wide `ProjectSession.Current` (`Runtime/ProjectSession.cs` L107). A project is a folder with `Project.json`.
Create writes the folder layout and sets every workflow item to Future except `project-setup` (Complete); 409 unless
`overwrite`. Open reloads measures, weather, and GeoJSON artifacts into the DataHub (ProjectController.cs L377-538)
and records the recent list. Close saves, swaps in an empty session, clears the DataHub, cancels jobs (up to 30 s).
Data passes between steps by DataHub `entryName`.

## 4. Uploads and downloads

- Multipart uploads: the fusion, schema-match, geometric, archetype-assignment, and baseline `replaceArtifact`
  routes and `previewUpload` (GeoJSON); `dataHub/upload*Entry`; `schemaMatching/uploadGeoJson`; `weather/upload`
  (`.epw`); `project/archetypes/upload` (`.json`, several); `templateAssignment/import`; `scenarioDesigner/import`;
  `project/shading/sidecar` (`.duckdb`); `resultViewer/upload`; `guiJob/upload`.
- Server-path inputs (client sends a path on the server's disk): create and open folder, `archetypes/load`,
  `measures/load`, `fusion/previewFromPath`, `weather/loadFromDisk`, shading `{filePath}`, voxel routes.
- Downloads: JSON with Content-Disposition (`templateAssignment/templated` and `export`, `scenarioDesigner/export`,
  `schemaMatching/saveToDataHub`); `application/octet-stream` (job database, guiJob downloads); MVT tiles; CSV and text
  from DataHub fetches.

## 5. OpenAPI and existing clients

Swashbuckle 6.5.0 (`EnergyAtlasWeb.csproj` L22) with XML docs (L7), configured at WebAppFactory L94-114 and L153-159,
not gated by environment: `/swagger/v1/swagger.json`, UI `/api-docs`. No `AddSwaggerGenNewtonsoftSupport` found, so
schema naming may differ from Newtonsoft output (unconfirmed); hand-read `JObject` bodies have no schema. No TypeScript,
`tsconfig`, or generated OpenAPI client anywhere. Handwritten Python client: `Connectors/python/src/energyatlas/
client.py` and `models.py` (Pydantic with camelCase aliases, e.g. `SimulationRunRequest` L362, `ResultSelection`
L485). Docs: `docs/api/api-reference.md` ("16 controllers / 201 endpoints", updated 2026-06-30, partly stale),
`docs/api/api-call-sequences.md`, `docs/llm-api-docs/web-api-reference.md` (generated 2026-10-17 from `feature/mcp`).

## 6. Map and geometry

GeoJSON (WGS84): `dataHub/fetchFeatureCollection`, `geoDataPreview/fetchGeoJson` and `fetchProjectFile`,
`buildingDownloader/fetchRegion`, `resultViewer/uploaded/{id}` and `censusOverlay`, `samples/ithacaBuildings`,
`capResultViewer/featureCollection`, `schemaMatching/applyMapping`. Paged attributes:
`geoDataPreview/getFeatureAttributes`. Vector tiles: the CAP viewer only. Zones and floors: `/api/zones*` return
numbers, **no zone or floor polygons** from any endpoint found.

## Unconfirmed

Exact Swagger output; camelCasing of dictionary keys in responses; full bodies of `zones/importDefinitions`,
`zoneSimulation/run`, `voxelShading/preview*`; response shapes of `schemaMatching/autoMatch` and
`templateAssignment/defaultRules`.
