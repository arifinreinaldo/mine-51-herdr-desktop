@echo off
REM Starts a dedicated, isolated herdr server session for GUI development
REM and the live check (spec §10). Runs in the FOREGROUND in this terminal
REM window -- leave it running and use a separate terminal for
REM dev-test.bat / npm run tauri dev / npm run bench:startup / npm run e2e.
REM
REM Uses the installed release herdr binary (never `cargo run`, per spec §1).
REM Stop it from another terminal with:  herdr session stop gui-test
REM Remove it entirely with:             herdr session delete gui-test

herdr --session gui-test server
