# 已运行测试的用例索引

2026-10-28：11 个文件，97 项测试通过。以下标题来自本次执行的文件；`it.each` 等参数化用例可能对应多个执行结果。

## pages/PipelineWorkspace.test.tsx

- L53：keeps one page-header action plus contextual creation and no empty pagination
- L64：keeps a way back from a later page that has become empty
- L75：starts at a searchable list and persists the selected pipeline, tab and run in the URL
- L97：reads saved historical definitions and gives them no editing or run controls
- L112：remembers the selected run when checking the graph and restores directory filters on return
- L130：opens an active run instead of submitting a second run for the same version
- L141：double clicking creates one idempotent submission and a refreshed deep link finds that same run
- L167：reuses the same submission key after an uncertain error and page reload
- L198：waits for the version
- L213：opens the video creation route without creating or running anything until explicitly requested
- L225：enables an installed plugin through the independent operator library
- L235：distinguishes failed directory loading from a first-time empty project and retries
- L247：clears unmatched pipeline directory filters through the empty state
- L257：offers plugin activation beside the empty operator library and clears unmatched filters

## pages/PipelineEditorReview.test.tsx

- L57：refreshes a cached clean graph and submits the exact version shown on the button
- L69：preserves dirty content on a version conflict and explicitly rebases the next save
- L85：can replace a dirty draft with the latest version and clear its undo history
- L96：fetches the latest baseline after a save conflict without losing the draft
- L107：edits referenced integer and enum parameters with their correct JSON types
- L120：provides full JSON editing for nested or combined schemas
- L133：disables incompatible and cyclic upstream choices and rejects bypassed DOM changes
- L151：edits each named port independently, enforces its type, and saves complete inputs
- L180：autoconnects only a compatible named port and respects explicit cache/retry flags
- L195：keeps invalid JSON visible when switching to the form and offers an explicit recovery
- L218：keeps genuine edits dirty when discarding a later invalid JSON attempt
- L236：preserves another node
- L251：gives node parameters priority over the palette in a compact workspace
- L267：keeps the complete long resource name as the heading, separate from the edit action
- L278：opens naming directly from the flow heading
- L286：seeds the exact enabled operator once and asks for a name before the first save
- L298：undoes and redoes node additions and deletion without losing dependencies
- L313：leaves a new processing node disconnected when no upstream was selected
- L322：connects a new processing node to the selected compatible source, not the last source
- L333：does not connect a new node to a selected output operator even if its output type matches
- L345：paginates the directory from the URL and sends search/status filters to the server
- L371：filters old-version history on the server before pagination and preserves its run link

## pages/PipelinesProjectScope.test.tsx

- L75：opens the linked project
- L107：falls back to the auth project and isolates editor state when an explicit project changes

## pages/PipelinesRunDetail.test.tsx

- L39：retries the existing run once and refreshes its selected view and list
- L77：refreshes status after an uncertain failed request without creating another run
- L98：only offers retry for pending errors with run permission
- L112：lets a user inspect a running or failed node before it has an artifact
- L135：downloads the complete authorized export instead of the bounded artifact preview
- L154：reconciles an unknown submission without calling retry or launching another run
- L173：shows cancellation as in progress until the execution engine confirms termination

## pages/PluginDevelopment.test.tsx

- L59：restores the selected candidate and scopes every persisted lifecycle read to its project
- L75：uploads a wheel, imported manifest and tests as a candidate, without validation or activation side effects
- L93：rejects invalid test JSON and oversized wheels before making an upload request
- L111：surfaces a failed template download rather than delivering a fabricated archive
- L119：uses recorded validation results to unlock publishing and enables only the ready published release
- L138：shows an execution error and blocked report after validation instead of claiming success
- L147：keeps permission explanations and blocks published-but-unready activation in the project library
- L162：reports API rejection, does not mark a release published and avoids duplicate action clicks
- L173：checks the URL project
- L183：keeps the current project in permission request links
- L191：confirms closing a dirty candidate and retains its files and edits when reopened
- L216：guards Escape, keeps editing by default, and clears a draft only after explicit discard
- L236：groups releases by plugin and exposes the selected version without duplicating plugin names
- L247：shows a failed case summary and expected versus actual results before raw report details
- L263：keeps incomplete report entries readable without treating a string result as passed
- L273：pages through server results and searches older releases while retaining the selected detail
- L299：requests published releases on each activation page and allows server-side version search
- L319：restores text after leaving the site route and after remount, and requires choosing the wheel again
- L344：does not restore a draft into a different project
- L353：filters a complete plugin version history by exact identity and preserves the scope in its URL
- L368：previews published plugin capabilities before activation and links the exact enabled operator to a new pipeline
- L385：guides an unready published version toward environment preparation rather than activation
- L394：provides contextual first-version creation without empty pagination or a selection prompt
- L405：clears an unmatched version query without presenting first-time creation

## components/PipelineCanvas.test.ts

- L21：accepts compatible edges while rejecting source inputs, mismatched types and cycles
- L29：requires exact registered operator versions before connecting
- L34：lays out branching graphs without changing data dependencies
- L44：checks the selected named input type, exact port, sink restrictions and cycles
- L61：replaces only one input while preserving other ports and ignores invalid connections

## components/PipelineCanvasInteractions.test.tsx

- L27：keeps named viewport controls usable in read-only mode and disables zoom at its limits
- L44：respects reduced motion while still arranging and fitting the complete graph
- L52：preserves the viewport when selection changes
- L59：records a drag as one undo step even when its first event has not moved
- L72：deletes a node and its downstream input through React Flow
- L79：blocks mutation callbacks in read-only mode
- L87：connects and deletes one named port without overwriting the other port

## components/PipelineDebugControls.test.tsx

- L25：preflights the selected dependency closure and submits its exact digest and fixed sample
- L50：blocks a dirty draft and reports why without preflighting the unsaved graph
- L57：preflights and runs with the same explicit disabled cache setting
- L71：invalidates preflight on target change and ignores a late response from the old target
- L82：shows backend rejection reasons instead of permitting execution
- L89：retries uncertain submission with the original idempotency key and options

## components/PipelineDeployments.test.tsx

- L49：creates an immutable interval deployment with project and CSRF, pauses it, then triggers one run
- L69：blocks malformed node overrides before saving

## components/ArtifactDatasetActions.test.tsx

- L18：prevents publishing debug artifacts and incomplete production runs
- L22：blocks oversized complete artifacts rather than importing only their preview
- L25：reports successful candidate import with unresolved quality gates and links the existing publishing UI
- L37：retries an uncertain import with the original name and derived server identity
- L47：uses the same derived identity after a fresh page visit and permits a different named candidate

## pipeline-schema.test.ts

- L6：resolves escaped JSON pointers, referenced enums and nullable references
- L16：resolves root references and exposes allOf properties and required fields
- L21：rejects unresolved, recursive and remote refs without fetching anything
