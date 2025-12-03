; EasyRip NSIS Custom Installer Script
; Shows a dependencies page with checkboxes for MakeMKV and 7-Zip installation

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Variables for dependency detection and checkboxes
Var MakeMKVInstalled
Var SevenZipInstalled
Var MakeMKVAvailable
Var SevenZipAvailable
Var InstallMakeMKV
Var InstallSevenZip
Var Dialog
Var LabelHeader
Var LabelInfo
Var CheckMakeMKV
Var CheckSevenZip
Var LabelMakeMKVStatus
Var LabelSevenZipStatus

; ========================================
; Custom page for dependency installation
; ========================================

Function dependenciesPage
  ; Check what's installed and what's available
  Call DetectDependencies

  ; Skip page if everything is installed
  ${If} $MakeMKVInstalled == "1"
  ${AndIf} $SevenZipInstalled == "1"
    Abort ; Skip this page
  ${EndIf}

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ; Header
  ${NSD_CreateLabel} 0 0 100% 20u "EasyRip requires the following components:"
  Pop $LabelHeader
  CreateFont $0 "$(^Font)" 10 700
  SendMessage $LabelHeader ${WM_SETFONT} $0 0

  ; Info text
  ${NSD_CreateLabel} 0 25u 100% 20u "Select which components to install. Unchecked items will need to be installed manually."
  Pop $LabelInfo

  ; Current Y position for dynamic layout
  StrCpy $1 55 ; Starting Y position in units

  ; MakeMKV Section
  ${If} $MakeMKVInstalled == "0"
    ${If} $MakeMKVAvailable == "1"
      ${NSD_CreateCheckbox} 10u $1u 90% 12u "Install MakeMKV (required for disc ripping)"
      Pop $CheckMakeMKV
      ${NSD_Check} $CheckMakeMKV ; Checked by default
      IntOp $1 $1 + 15
      ${NSD_CreateLabel} 25u $1u 90% 10u "MakeMKV will be installed using the bundled installer"
      Pop $LabelMakeMKVStatus
    ${Else}
      ${NSD_CreateLabel} 10u $1u 90% 12u "MakeMKV (required) - NOT FOUND"
      Pop $LabelMakeMKVStatus
      CreateFont $0 "$(^Font)" 8 700
      SendMessage $LabelMakeMKVStatus ${WM_SETFONT} $0 0
      IntOp $1 $1 + 15
      ${NSD_CreateLabel} 25u $1u 90% 10u "Please download from: https://www.makemkv.com/download/"
      Pop $0
    ${EndIf}
    IntOp $1 $1 + 20
  ${Else}
    ${NSD_CreateLabel} 10u $1u 90% 12u "MakeMKV - Already installed"
    Pop $LabelMakeMKVStatus
    IntOp $1 $1 + 20
  ${EndIf}

  ; 7-Zip Section
  ${If} $SevenZipInstalled == "0"
    ${If} $SevenZipAvailable == "1"
      ${NSD_CreateCheckbox} 10u $1u 90% 12u "Install 7-Zip (recommended for archive handling)"
      Pop $CheckSevenZip
      ${NSD_Check} $CheckSevenZip ; Checked by default
      IntOp $1 $1 + 15
      ${NSD_CreateLabel} 25u $1u 90% 10u "7-Zip will be installed using the bundled installer"
      Pop $LabelSevenZipStatus
    ${Else}
      ${NSD_CreateLabel} 10u $1u 90% 12u "7-Zip (recommended) - NOT FOUND"
      Pop $LabelSevenZipStatus
      IntOp $1 $1 + 15
      ${NSD_CreateLabel} 25u $1u 90% 10u "Please download from: https://www.7-zip.org/download.html"
      Pop $0
    ${EndIf}
  ${Else}
    ${NSD_CreateLabel} 10u $1u 90% 12u "7-Zip - Already installed"
    Pop $LabelSevenZipStatus
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function dependenciesPageLeave
  ; Get checkbox states
  ${If} $CheckMakeMKV != ""
    ${NSD_GetState} $CheckMakeMKV $InstallMakeMKV
  ${Else}
    StrCpy $InstallMakeMKV "0"
  ${EndIf}

  ${If} $CheckSevenZip != ""
    ${NSD_GetState} $CheckSevenZip $InstallSevenZip
  ${Else}
    StrCpy $InstallSevenZip "0"
  ${EndIf}
FunctionEnd

Function DetectDependencies
  ; Initialize
  StrCpy $MakeMKVInstalled "0"
  StrCpy $SevenZipInstalled "0"
  StrCpy $MakeMKVAvailable "0"
  StrCpy $SevenZipAvailable "0"

  ; Check for MakeMKV
  IfFileExists "$PROGRAMFILES64\MakeMKV\makemkvcon64.exe" 0 +2
    StrCpy $MakeMKVInstalled "1"
  IfFileExists "$PROGRAMFILES\MakeMKV\makemkvcon64.exe" 0 +2
    StrCpy $MakeMKVInstalled "1"
  IfFileExists "$PROGRAMFILES32\MakeMKV\makemkvcon64.exe" 0 +2
    StrCpy $MakeMKVInstalled "1"

  ; Check for 7-Zip
  IfFileExists "$PROGRAMFILES64\7-Zip\7z.exe" 0 +2
    StrCpy $SevenZipInstalled "1"
  IfFileExists "$PROGRAMFILES\7-Zip\7z.exe" 0 +2
    StrCpy $SevenZipInstalled "1"
  IfFileExists "$PROGRAMFILES32\7-Zip\7z.exe" 0 +2
    StrCpy $SevenZipInstalled "1"

  ; Check if bundled installers are available
  IfFileExists "$INSTDIR\resources\installers\MakeMKV-Setup.exe" 0 +2
    StrCpy $MakeMKVAvailable "1"
  IfFileExists "$INSTDIR\resources\installers\7z-Setup.exe" 0 +2
    StrCpy $SevenZipAvailable "1"
FunctionEnd

; ========================================
; Custom install macro - runs dependencies
; ========================================

!macro customInstall
  ; Run the dependency installers based on user selection

  ; Install MakeMKV if selected
  ${If} $InstallMakeMKV == "1"
    DetailPrint "Installing MakeMKV..."
    DetailPrint "Please follow the MakeMKV installer prompts."
    ExecWait '"$INSTDIR\resources\installers\MakeMKV-Setup.exe"' $0
    ${If} $0 == 0
      DetailPrint "MakeMKV installed successfully."
    ${Else}
      DetailPrint "MakeMKV installer returned code: $0"
    ${EndIf}
  ${EndIf}

  ; Install 7-Zip if selected
  ${If} $InstallSevenZip == "1"
    DetailPrint "Installing 7-Zip..."
    DetailPrint "Please follow the 7-Zip installer prompts."
    ExecWait '"$INSTDIR\resources\installers\7z-Setup.exe"' $0
    ${If} $0 == 0
      DetailPrint "7-Zip installed successfully."
    ${Else}
      DetailPrint "7-Zip installer returned code: $0"
    ${EndIf}
  ${EndIf}

  DetailPrint "EasyRip installation complete."
!macroend

; Uninstall macro
!macro customUnInstall
  ; Optional cleanup - uncomment to offer settings removal
  ; MessageBox MB_YESNO "Remove EasyRip settings and data?" IDNO +3
  ;   RMDir /r "$PROFILE\.easyrip"
  ;   Delete "$PROFILE\.easyrip-settings.json"
!macroend

; ========================================
; Register custom page with installer
; ========================================

!macro customWelcomePage
  ; This runs before the welcome page
!macroend

!macro customHeader
  ; Add our dependencies page after the directory selection
  Page custom dependenciesPage dependenciesPageLeave
!macroend
