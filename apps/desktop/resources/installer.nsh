; Installs into %LOCALAPPDATA%\Programs\TRC for the current user (P-87), unless an earlier install chose a folder:
; electron-builder's per-user mode reads InstallLocation before it falls back to the product name's folder.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 == ""
      WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\TRC"
    ${EndIf}
  !endif
!macroend
