@echo off
REM Runs `npm run tauri dev` against the dedicated `gui-test` herdr session
REM (spec §10). Start scripts\test-session.bat in its own terminal first.
REM
REM Aborts if the resolved client socket path is not under
REM sessions\gui-test (e.g. because HERDR_SOCKET_PATH or
REM HERDR_CLIENT_SOCKET_PATH in this shell would otherwise override
REM HERDR_SESSION and point at your default session).

setlocal
set HERDR_SESSION=gui-test

pushd "%~dp0.."
node scripts\assert-gui-test-session.mjs "dev-test.bat" || (popd & exit /b 1)
npm run tauri dev
popd
