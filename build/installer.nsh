; Adds the "klyngex" and "kx" commands: two small launchers in a folder Windows already has
; on every user's PATH, so nothing has to be added to the PATH itself.
; They pass the folder they were typed in, and Klyngex opens a terminal there.
!macro customInstall
  CreateDirectory "$LOCALAPPDATA\Microsoft\WindowsApps"
  FileOpen $0 "$LOCALAPPDATA\Microsoft\WindowsApps\klyngex.cmd" w
  FileWrite $0 '@start "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" --cwd="%CD%\."$\r$\n'
  FileClose $0
  CopyFiles /SILENT "$LOCALAPPDATA\Microsoft\WindowsApps\klyngex.cmd" "$LOCALAPPDATA\Microsoft\WindowsApps\kx.cmd"
!macroend

!macro customUnInstall
  Delete "$LOCALAPPDATA\Microsoft\WindowsApps\klyngex.cmd"
  Delete "$LOCALAPPDATA\Microsoft\WindowsApps\kx.cmd"
!macroend
