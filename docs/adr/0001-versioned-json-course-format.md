# Use one versioned JSON format for built-in and custom courses

Built-in and player-supplied courses will use the same versioned JSON schema and pass through the same loading, validation, and terrain-rasterization pipeline. This adds schema-compatibility and validation work compared with source-embedded hole layouts, but it makes courses replaceable without code changes and prevents built-in content from exercising a privileged path; a visual hole editor remains out of scope.
