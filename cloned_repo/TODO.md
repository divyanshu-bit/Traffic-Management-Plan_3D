- [ ] Refactor Maparea.jsx to remove cursorPoint React state and drive draft preview via MapLibre source.setData
- [ ] Keep draftCoords as React state for click/undo/finish behavior
- [ ] Ensure mousemove throttling/RAF updates only refs and calls setData (no React re-renders)
- [ ] Clear/update draft preview source on finish/undo/cancel/activeTool changes
- [ ] Validate build and run-time draw preview + undo/cancel/rectangle auto-finish

