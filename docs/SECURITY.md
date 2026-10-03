# Security model

Orbit is local-first. No account, telemetry, update client, background HTTP service or database is present. The frontend CSP excludes remote scripts, frames and objects. Native actions are Rust commands; the frontend has no shell/fs plugin permissions. Editor mutations and action execution check the invoking window label. Backend execution resolves a saved node ID rather than accepting an arbitrary command payload.

Application/Command arguments remain separate literal values. There is no implicit command shell. A user can deliberately configure a shell executable as an action; Orbit does not synthesize shell strings. URLs are limited to http/https/mailto. Dangerous system power actions are not implemented.

An imported profile gets new IDs and is untrusted regardless of its supplied trusted flag. Executable/command actions require explicit review/enable/Save. Preview blocks all execution in both frontend and backend. Untrusted imported profiles use built-in fallback icons until review; embedded custom images are decoded with bounds and normalized to PNG. Importing or editing never executes actions. Saved node labels/profile names are HTML-escaped. Node/icon/manifest filenames disallow traversal.

Configuration commits use flushed temporary files, immutable profile generations, and atomic manifest replacement. The previous valid manifest is retained. Corruption recovery preserves damaged bytes. Optimistic revision checks prevent an editor from silently overwriting configuration changed by launcher profile selection.

Local files remain readable/modifiable by the current Windows user. Configurations are not encrypted or signed. Review imported paths and arguments; external programs, file associations and user-requested URLs are outside Orbit's control. Diagnostic logs and profile exports can contain local paths. Automatic pruning of immutable generations is not implemented.
