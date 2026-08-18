# Architecture
Phantom Protocol is a build-free ES-module application. Data registries are isolated from runtime systems. The canvas simulation owns the hot gameplay path while DOM UI is used only for menus and HUD overlays. Save data is versioned and centralized in `src/save/storage.js`.
