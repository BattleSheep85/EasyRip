; EasyRip NSIS Custom Installer Script
; This script runs after the main installation to check for and install dependencies

!macro customInstall
  ; Variables for tracking installation
  Var /GLOBAL MakeMKVFound
  Var /GLOBAL SevenZipFound

  ; Initialize variables
  StrCpy $MakeMKVFound "0"
  StrCpy $SevenZipFound "0"

  ; ========================================
  ; Check for MakeMKV installation
  ; ========================================

  ; Check 64-bit Program Files
  IfFileExists "$PROGRAMFILES64\MakeMKV\makemkvcon64.exe" MakeMKVFoundLabel 0
  ; Check 32-bit Program Files
  IfFileExists "$PROGRAMFILES\MakeMKV\makemkvcon64.exe" MakeMKVFoundLabel 0
  ; Check 32-bit Program Files (x86) on 64-bit Windows
  IfFileExists "$PROGRAMFILES32\MakeMKV\makemkvcon64.exe" MakeMKVFoundLabel 0

  ; MakeMKV not found - offer to install
  Goto MakeMKVNotFound

  MakeMKVFoundLabel:
    StrCpy $MakeMKVFound "1"
    Goto CheckSevenZip

  MakeMKVNotFound:
    ; Check if bundled installer exists
    IfFileExists "$INSTDIR\resources\installers\MakeMKV-Setup.exe" 0 MakeMKVNoInstaller
      MessageBox MB_YESNO|MB_ICONQUESTION "MakeMKV is required for disc ripping but was not found.$\n$\nWould you like to install it now?" IDNO CheckSevenZip
      DetailPrint "Installing MakeMKV..."
      ExecWait '"$INSTDIR\resources\installers\MakeMKV-Setup.exe"' $0
      DetailPrint "MakeMKV installer returned: $0"
      Goto CheckSevenZip

  MakeMKVNoInstaller:
    MessageBox MB_OK|MB_ICONINFORMATION "MakeMKV is required for disc ripping.$\n$\nPlease download and install it from:$\nhttps://www.makemkv.com/download/"

  CheckSevenZip:
  ; ========================================
  ; Check for 7-Zip installation
  ; ========================================

  ; Check 64-bit Program Files
  IfFileExists "$PROGRAMFILES64\7-Zip\7z.exe" SevenZipFoundLabel 0
  ; Check 32-bit Program Files
  IfFileExists "$PROGRAMFILES\7-Zip\7z.exe" SevenZipFoundLabel 0
  ; Check 32-bit Program Files (x86) on 64-bit Windows
  IfFileExists "$PROGRAMFILES32\7-Zip\7z.exe" SevenZipFoundLabel 0

  ; 7-Zip not found - offer to install
  Goto SevenZipNotFound

  SevenZipFoundLabel:
    StrCpy $SevenZipFound "1"
    Goto InstallComplete

  SevenZipNotFound:
    ; Check if bundled installer exists
    IfFileExists "$INSTDIR\resources\installers\7z-Setup.exe" 0 SevenZipNoInstaller
      MessageBox MB_YESNO|MB_ICONQUESTION "7-Zip is required for archive handling but was not found.$\n$\nWould you like to install it now?" IDNO InstallComplete
      DetailPrint "Installing 7-Zip..."
      ExecWait '"$INSTDIR\resources\installers\7z-Setup.exe"' $0
      DetailPrint "7-Zip installer returned: $0"
      Goto InstallComplete

  SevenZipNoInstaller:
    MessageBox MB_OK|MB_ICONINFORMATION "7-Zip is required for archive handling.$\n$\nPlease download and install it from:$\nhttps://www.7-zip.org/download.html"

  InstallComplete:
    ; Installation complete
    DetailPrint "EasyRip installation complete."
!macroend

; Uninstall macro (optional cleanup)
!macro customUnInstall
  ; Remove any EasyRip settings/data if user confirms
  ; Note: This is optional - uncomment if you want to offer cleanup
  ; MessageBox MB_YESNO "Do you want to remove EasyRip settings and data?" IDNO SkipCleanup
  ;   RMDir /r "$PROFILE\.easyrip"
  ;   Delete "$PROFILE\.easyrip-settings.json"
  ; SkipCleanup:
!macroend
