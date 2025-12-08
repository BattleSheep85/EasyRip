# EasyRip Video Guide Script

**Total Duration:** 14-15 minutes
**Target Audience:** Beginners to intermediate users backing up DVD/Blu-ray collections
**Style:** Friendly, clear, demonstration-focused

---

## 1. INTRO (0:00-0:45)

**[TIMING: 45 seconds]**

### [VISUAL]
- Open with EasyRip logo animation
- Transition to desktop with stacks of DVDs/Blu-rays next to a computer
- Quick montage: Disc inserting → Progress bar → Movie playing on server

### [NARRATION]
"Are you tired of manually backing up your DVD and Blu-ray collection? Spending hours clicking through menus, tracking which discs you've already ripped, and organizing your media library?

Meet EasyRip - a free, open-source Windows application that automates the entire disc backup workflow. From detection to backup, metadata identification to media server export, EasyRip handles it all.

In this video, I'll walk you through everything you need to know: installation, setup, basic backups, metadata management, and advanced automation features. By the end, you'll be running a fully automated disc backup system.

Let's dive in."

### [ACTION]
- Show EasyRip installer download page
- Transition to installation process

---

## 2. INSTALLATION (0:45-2:00)

**[TIMING: 1 minute 15 seconds]**

### [VISUAL]
- Browser showing GitHub releases page
- Download progress bar for EasyRip Setup
- Installer wizard screens

### [NARRATION]
"First, head to the EasyRip GitHub releases page - link in the description. Download the latest version, which is currently version 0.1.2. The installer is about 100 megabytes.

Run the setup executable. You can choose the installation directory, but the default Program Files location works great.

Now here's the cool part - EasyRip requires MakeMKV to actually rip the discs. MakeMKV is the industry-standard disc backup tool, and it's what's running under the hood. If EasyRip detects you don't have it installed, the installer will offer to download and install it for you automatically."

### [ACTION]
- Click download link
- Show installer running
- Demonstrate MakeMKV dependency check screen

### [VISUAL]
- Checkbox screen: "MakeMKV not found. Install it now?"
- MakeMKV installer running
- Desktop shortcut appearing

### [NARRATION]
"Just check the box and click 'Install Dependencies'. The installer handles everything. MakeMKV will open its own installer - just follow the prompts. Note that MakeMKV requires a beta key for Blu-ray support, but don't worry - EasyRip can auto-fetch that for you, which I'll show in a minute.

Once installation completes, you'll have an EasyRip shortcut on your desktop and in the Start menu."

### [ACTION]
- Complete installation
- Click desktop shortcut to launch EasyRip

---

## 3. INITIAL SETUP (2:00-4:00)

**[TIMING: 2 minutes]**

### [VISUAL]
- EasyRip main window appears (empty drive list)
- Cursor clicks Settings icon in sidebar

### [NARRATION]
"When you first launch EasyRip, you'll see the main drive list - currently empty since we haven't scanned yet. Before we start backing up discs, let's configure a few essential settings.

Click the Settings icon in the left sidebar. You'll see five tabs: General, Paths, Transfer, Appearance, and About. Let's start with General."

### [ACTION]
- Open Settings page
- Navigate to General tab

---

### **General Settings (2:15-3:00)**

### [VISUAL]
- General Settings tab selected
- MakeMKV path field (auto-populated)
- Beta key field with "Auto-Fetch" button
- TMDB API key field (empty)
- Ollama settings section

### [NARRATION]
"First, notice the MakeMKV path is already detected. If it's wrong, you can browse to the correct location - usually C:\Program Files (x86)\MakeMKV\makemkvcon64.exe.

Next, click 'Auto-Fetch Beta Key'. This grabs the latest public beta key from MakeMKV's forum and installs it for you. You'll need this for Blu-ray discs. The key expires monthly, so you can re-fetch it anytime.

Now for metadata - EasyRip can automatically identify your discs using The Movie Database API. To enable this, get a free API key from themoviedb.org - it takes 30 seconds to sign up. Paste it here. This allows EasyRip to look up movie titles, posters, years, and more.

For even better identification, especially for obscure or damaged disc labels, you can optionally install Ollama - a local AI model. Just install Ollama from ollama.ai, pull the llama3.2-vision model, and enter the API URL here. This is completely optional but improves accuracy."

### [ACTION]
- Click "Auto-Fetch Beta Key" (show success message)
- Paste TMDB API key
- Show Ollama URL field (demonstrate optional nature)

---

### **Paths Settings (3:00-3:40)**

### [VISUAL]
- Switch to Paths tab
- Base output path field
- Movie library and TV library fields

### [NARRATION]
"Switch to the Paths tab. This controls where your backups are stored.

Base Output Path is where EasyRip stores all backups. The default is D:\EasyRip, but you can change it to any drive with plenty of space. EasyRip uses two subfolders: 'temp' for in-progress backups, and 'backup' for completed ones.

If you're planning to export backups to a media server like Emby or Jellyfin, set your Movie Library Path and TV Library Path here. These are the final destinations where properly-named, metadata-enriched files will be copied. We'll cover exports in detail later."

### [ACTION]
- Show default path structure
- Explain temp vs backup folders
- Click Browse to demonstrate path selection

---

### **Quick Tour of Other Tabs (3:40-4:00)**

### [VISUAL]
- Quickly show Transfer and Appearance tabs

### [NARRATION]
"We'll skip Transfer settings for now - we'll cover those when we discuss exports. Appearance lets you choose between light and dark themes, or auto-match your system. And the About tab shows version info and credits.

Let's save these settings and start backing up discs."

### [ACTION]
- Click Save button (show success toast)
- Navigate back to Home

---

## 4. BASIC BACKUP (4:00-7:00)

**[TIMING: 3 minutes]**

### [VISUAL]
- Main drive list page (empty)
- Physical hand inserting DVD into drive
- Click "Refresh Drives" button

### [NARRATION]
"Back on the home page, let's insert a disc. I'm using a DVD copy of The Matrix. Once the disc is loaded, click 'Refresh Drives' in the toolbar.

EasyRip scans your system for optical drives and checks what's inside. This usually takes 2-3 seconds. And there it is - Drive E: with 'THE_MATRIX' detected. EasyRip shows the disc name, size, and current backup status."

### [ACTION]
- Insert disc
- Click Refresh Drives
- Wait for drive table to populate

---

### **Understanding the Drive Table (4:30-5:15)**

### [VISUAL]
- Drive table with one row
- Highlight each column: Drive, Disc Name, Size, Status, Action

### [NARRATION]
"Let's understand this table. Column one shows the drive letter - E: in this case. Column two is the disc name, pulled from the volume label. Column three shows the approximate disc size - 7.4 gigabytes here.

Column four is the backup status. Right now it says 'Ready', meaning no backup exists and we can start one. Other statuses you might see are:
- 'Done' - backup already complete
- 'Incomplete' - partial backup detected
- 'Running' - backup in progress
- 'Queued' - waiting in line
- 'Error' - backup failed

And finally, the Action column has the Backup button."

### [ACTION]
- Hover over each column header
- Show tooltip explanations

---

### **Starting a Backup (5:15-6:30)**

### [VISUAL]
- Click Backup button
- Progress bar appears
- Percentage increases
- Log panel shows MakeMKV output

### [NARRATION]
"Click 'Backup' to start. EasyRip queues the job and sends it to MakeMKV. You'll see the status change to 'Running' and a progress bar appears.

The progress percentage comes directly from MakeMKV as it processes the disc. You'll also see a live log output showing detailed information - track processing, file sizes, and more. For most DVDs, expect 10-20 minutes. Blu-rays take longer depending on size.

While the backup runs, you can:
- View live logs by clicking the dropdown arrow
- Cancel the backup if needed
- Insert another disc in a different drive and start a parallel backup

Yes, EasyRip supports multiple simultaneous backups across different drives. It's a huge time-saver if you have multiple optical drives."

### [ACTION]
- Watch progress bar increment
- Open log panel
- Show Cancel button (but don't click)

---

### **Backup Completion (6:30-7:00)**

### [VISUAL]
- Progress reaches 100%
- Status changes to "Done"
- Toast notification: "Backup complete"
- Disc ejects (if auto-eject enabled)

### [NARRATION]
"Once the backup completes, the status changes to 'Done', and you'll see a toast notification. If you enabled auto-eject in settings, the disc will pop out automatically.

The backup is now stored in your base path under the 'backup' folder, organized by disc name. EasyRip extracts all titles from the disc - usually the main movie plus extras.

But we're not done yet. Now comes the magic - automatic metadata identification."

### [ACTION]
- Show completion
- Click folder icon to open backup location in File Explorer

---

## 5. METADATA FEATURES (7:00-9:00)

**[TIMING: 2 minutes]**

### [VISUAL]
- Navigate to Metadata page in sidebar
- List of backed-up discs with "Pending" badges

### [NARRATION]
"Click the 'Metadata' icon in the sidebar. Here you'll see all your backups. Notice 'The Matrix' shows a 'Pending' badge - it hasn't been identified yet.

If you enabled auto-metadata in settings, EasyRip would have already searched TMDB for matches. But let's do it manually to see how it works."

### [ACTION]
- Open Metadata page
- Locate THE_MATRIX in list

---

### **Automatic Identification (7:30-8:15)**

### [VISUAL]
- Click "Identify" button
- Loading spinner
- Search results modal appears with multiple matches
- Select "The Matrix (1999)"
- Metadata preview: poster, title, year, overview

### [NARRATION]
"Click 'Identify'. EasyRip sends the disc name to TMDB and searches for matches. In this case, it found 'The Matrix' from 1999 - perfect. Click it to see the full metadata.

You'll see the movie poster, release year, overview, genre, and more. This metadata will be embedded into the exported file and used to generate NFO files for your media server.

If the automatic match is wrong - maybe the disc label was unclear - you can manually search or edit the metadata fields. EasyRip gives you full control."

### [ACTION]
- Click Identify button
- Select correct match from list
- Review metadata preview

---

### **Approving Metadata (8:15-8:45)**

### [VISUAL]
- Click "Approve" button
- "Pending" badge changes to "Approved" with checkmark
- Metadata badge shows movie poster thumbnail

### [NARRATION]
"If everything looks good, click 'Approve'. The badge changes to 'Approved', and you'll see a tiny poster thumbnail next to the disc name. This signals that the backup is ready for export.

If you're using 'Live Dangerously' mode - an advanced automation setting - EasyRip will auto-approve metadata without asking. Great for large batch jobs, but risky if you want to verify everything manually."

### [ACTION]
- Click Approve
- Show status change
- Point out green checkmark

---

### **Manual Corrections (8:45-9:00)**

### [VISUAL]
- Click on a different disc with incorrect metadata
- Show Edit Metadata form
- Correct title field
- Re-search TMDB

### [NARRATION]
"If EasyRip gets it wrong - say it matched 'Alien' instead of 'Aliens' - just click the disc, hit 'Edit', and correct the title. You can also manually enter TMDB IDs or switch between Movie and TV Show types.

Once approved, your backup is ready to export to your media server."

### [ACTION]
- Demonstrate editing interface
- Save corrected metadata

---

## 6. EXPORT & TRANSFER (9:00-11:00)

**[TIMING: 2 minutes]**

### [VISUAL]
- Navigate to Export page in sidebar
- List of approved backups ready for export
- Export Manager interface

### [NARRATION]
"Click the 'Export' icon to open Export Manager. This is where the magic happens. EasyRip takes your raw MKV backups and prepares them for media servers like Emby, Jellyfin, or Plex.

You'll see all approved backups listed here. For each one, you can choose where to send it and in what format."

### [ACTION]
- Open Export page
- Show list of approved backups

---

### **Export Options (9:30-10:15)**

### [VISUAL]
- Highlight export options dropdown
- Show options: Local, UNC/SMB, SFTP, SCP, FTP

### [NARRATION]
"EasyRip supports multiple transfer protocols:

- Local Copy - copies files directly to a local folder or mapped network drive. Great if your media server is on the same machine or you've mapped a network share.

- UNC/SMB - Windows network shares. Use this for NAS devices or Windows servers. Format is backslash-backslash-server-backslash-share.

- SFTP - SSH File Transfer Protocol. Best for Linux servers and most NAS devices. Uses SSH keys or password auth.

- SCP - Secure Copy Protocol. Similar to SFTP but simpler. Good for Linux servers.

- FTP - Standard FTP with optional TLS encryption. Least secure but widely supported.

Configure these protocols in Settings → Transfer. For now, let's use Local Copy since it's simplest."

### [ACTION]
- Hover over each protocol option
- Show Settings → Transfer tab briefly

---

### **Performing an Export (10:15-10:50)**

### [VISUAL]
- Select "The Matrix" backup
- Click "Export" button
- Export settings modal: choose Movie Library, select protocol
- Click "Start Export"
- Progress bar appears
- Export completes

### [NARRATION]
"Select your approved backup - The Matrix - and click 'Export'. Choose your destination library - Movie or TV - and protocol. EasyRip will:

1. Remux the MKV with proper codec tags
2. Rename it according to media server conventions - 'The Matrix (1999).mkv'
3. Generate an NFO file with full metadata for scraping
4. Transfer it to your specified library path

For movies, it creates a folder named 'The Matrix (1999)' with the file and NFO inside. For TV shows, it organizes by season and episode.

Click 'Start Export'. Depending on file size and transfer speed, this takes a few minutes. Once done, your media server can scan and add it to your library automatically."

### [ACTION]
- Configure export settings
- Start export
- Show progress
- Open destination folder to show final structure

---

### **Emby Integration (10:50-11:00)**

### [VISUAL]
- Show Emby dashboard with newly-added movie

### [NARRATION]
"If you're using Emby or Jellyfin, trigger a library scan, and your movie appears instantly with full metadata, poster, and all. No manual work required."

### [ACTION]
- Refresh Emby library
- Show movie with poster and metadata

---

## 7. AUTOMATION (11:00-12:30)

**[TIMING: 1 minute 30 seconds]**

### [VISUAL]
- Back to Home page
- Toolbar with automation toggle switches

### [NARRATION]
"Now let's talk automation. EasyRip has five toggle switches in the toolbar that control fully-automated workflows. Let me explain each one."

### [ACTION]
- Point to toolbar toggles

---

### **Automation Toggles Explained (11:15-12:15)**

### [VISUAL]
- Highlight each toggle as explained
- Show visual icons

### [NARRATION]
"**Auto-Backup** - When enabled, EasyRip automatically starts a backup as soon as you insert a disc. No need to click Refresh or Backup. Just insert and walk away.

**Auto-Metadata** - Automatically searches for and applies metadata to new backups. You'll still need to approve it unless...

**Auto-Export** - Exports approved backups immediately to your media server. Combined with auto-metadata, this creates a fully hands-off workflow.

**Auto-Eject** - Ejects the disc after a successful backup. Great for batch jobs - just keep feeding discs.

**Live Dangerously** - This is the ultimate automation mode. It skips all confirmations and auto-approves metadata. Use with caution - it assumes TMDB always gets it right. Perfect for large collections where you trust the automatic matching.

When you enable all five toggles, you get true walk-away automation. Insert disc, wait for eject, insert next disc. EasyRip handles everything from backup to metadata to export."

### [ACTION]
- Toggle each switch on
- Show visual feedback (switch turns green)
- Demonstrate full automation with a test disc

---

### **Workflow Example (12:15-12:30)**

### [VISUAL]
- Insert disc with all toggles enabled
- Watch automation: auto-detect → auto-backup → auto-metadata → auto-export → auto-eject

### [NARRATION]
"Here's the full automation in action. I insert a disc. Within seconds, EasyRip detects it, starts the backup, searches metadata, approves it, exports to my server, and ejects the disc. Zero clicks. Pure automation.

This is how you burn through a stack of 50 DVDs in an afternoon."

### [ACTION]
- Show real-time automated workflow
- Highlight each step as it happens

---

## 8. ADVANCED TIPS (12:30-14:00)

**[TIMING: 1 minute 30 seconds]**

### [VISUAL]
- Split-screen: Multiple drives backing up simultaneously

### [NARRATION]
"Let me share some advanced tips to maximize efficiency."

---

### **Parallel Backups (12:40-13:00)**

### [NARRATION]
"Tip one: Parallel backups. If you have multiple optical drives, EasyRip can back them up simultaneously. Insert discs in all drives, refresh, and click Backup for each. MakeMKV runs separate instances for each drive, cutting your total rip time in half or more.

The queue system ensures everything runs smoothly. If you start more backups than your CPU can handle, they'll queue automatically."

### [ACTION]
- Show two drives backing up at once
- Show queue position indicator

---

### **Queue Management (13:00-13:20)**

### [VISUAL]
- Show drive list with multiple queued backups

### [NARRATION]
"Tip two: Queue management. You can queue as many backups as you want. EasyRip shows the queue position for each - '2 of 5', for example. If you need to cancel a queued backup, just click Cancel before it starts."

### [ACTION]
- Queue multiple backups
- Show queue positions
- Cancel one queued backup

---

### **Logs and Troubleshooting (13:20-13:45)**

### [VISUAL]
- Open Logs page in sidebar
- Scrollable log viewer with filter options

### [NARRATION]
"Tip three: Logs. If something goes wrong - a backup fails, metadata doesn't match, or a transfer errors out - check the Logs page. EasyRip logs everything: drive scans, MakeMKV output, TMDB searches, file transfers.

You can filter logs by date, search for keywords, and even export them for troubleshooting. This is invaluable for debugging issues."

### [ACTION]
- Open Logs page
- Scroll through logs
- Use search filter

---

### **Keyboard Shortcuts (13:45-14:00)**

### [VISUAL]
- Overlay showing keyboard shortcuts

### [NARRATION]
"Tip four: Keyboard shortcuts. EasyRip is mostly mouse-driven, but you can use Escape to close any modal quickly. It's a small thing, but speeds up navigation.

Alright, that covers the advanced tips. Let's wrap up."

### [ACTION]
- Press Escape to close modal
- Demonstrate navigation shortcuts

---

## 9. OUTRO (14:00-15:00)

**[TIMING: 1 minute]**

### [VISUAL]
- Fade to EasyRip logo
- Split-screen: Before (manual work) vs After (automated)

### [NARRATION]
"And there you have it - a complete guide to EasyRip. Let's recap what we covered:

- Installation and initial setup with MakeMKV integration
- Basic backup workflow from disc to MKV files
- Automatic metadata identification using TMDB and Ollama
- Exporting to media servers with multiple transfer protocols
- Full automation modes for hands-free disc processing
- Advanced tips for parallel backups, queue management, and troubleshooting

With EasyRip, backing up your disc collection goes from tedious manual work to a simple, automated process. Whether you're ripping one disc or a thousand, EasyRip has you covered.

If you run into issues or have questions, check the GitHub repository - link in the description. You'll find detailed documentation, FAQs, and an active community ready to help. If you find EasyRip useful, consider starring the repo or contributing to the project.

Thanks for watching, and happy ripping!"

### [ACTION]
- Show GitHub link overlay
- Display call-to-action buttons: Subscribe, Star on GitHub, Watch Next Video

### [VISUAL]
- End screen with social links and next video suggestions

---

## VIDEO PRODUCTION NOTES

### Equipment Recommendations
- **Screen Capture:** OBS Studio or Camtasia (1080p minimum, 60fps preferred)
- **Audio:** Clear USB microphone (Blue Yeti, Audio-Technica AT2020)
- **Editing:** DaVinci Resolve or Adobe Premiere Pro

### Filming Tips
1. **Clean UI:** Use default theme, hide personal paths
2. **Real Discs:** Use actual DVDs/Blu-rays for authenticity
3. **Smooth Cursor:** Enable smooth mouse movement, no jerky clicks
4. **Pace Slowly:** Give viewers time to read on-screen text
5. **Add Captions:** Include closed captions for accessibility

### B-Roll Ideas
- Physical disc collection on shelf
- Disc inserting into drive (close-up)
- File Explorer showing backup folders
- Media server (Emby/Jellyfin) displaying imported movies
- Side-by-side comparison: manual ripping vs EasyRip

### Graphics Overlays
- **0:10:** Feature list overlay
- **2:05:** Settings tab indicators
- **4:35:** Status meaning reference card
- **11:15:** Automation toggle cheat sheet
- **13:45:** Keyboard shortcuts overlay

### Music Suggestions
- **Intro:** Upbeat, tech-focused (30 sec)
- **Background:** Subtle, non-distracting ambient
- **Outro:** Uplifting, call-to-action energy

### Thumbnail Ideas
- EasyRip logo + "Complete Guide" text
- Before/After split: messy discs vs organized library
- "DVD Backup Made EASY" with progress bar graphic

### YouTube Description Template
```
Master DVD and Blu-ray backup with EasyRip - a free, open-source automation tool for Windows.

TIMESTAMPS:
0:00 - Introduction
0:45 - Installation
2:00 - Initial Setup
4:00 - Basic Backup Workflow
7:00 - Metadata Features
9:00 - Export & Transfer
11:00 - Automation Modes
12:30 - Advanced Tips
14:00 - Recap & Resources

LINKS:
- Download EasyRip: https://github.com/BattleSheep85/EasyRip/releases
- MakeMKV: https://www.makemkv.com/
- TMDB API Key: https://www.themoviedb.org/settings/api
- Ollama (Optional): https://ollama.ai/

CHAPTERS: [Auto-generated by YouTube]

#EasyRip #DVDBackup #BluRay #MakeMKV #Emby #Jellyfin #Plex #HomeMediaServer
```

---

## COMMON QUESTIONS TO ADDRESS (Pinned Comment)

**Q: Is EasyRip legal?**
A: Yes. Backing up your own purchased discs for personal use is legal in most jurisdictions. Check your local laws.

**Q: Do I need to pay for MakeMKV?**
A: MakeMKV offers free beta keys that work for all features. EasyRip can auto-fetch these for you.

**Q: Does this work on Mac or Linux?**
A: Currently Windows-only. Linux support is being considered for future releases.

**Q: Can I backup 4K UHD discs?**
A: Yes, if your drive supports it and you have MakeMKV configured properly.

**Q: How much disk space do I need?**
A: DVDs: 4-8 GB. Blu-rays: 20-50 GB. 4K UHD: 50-100 GB per disc.

**Q: Can I pause a backup?**
A: Not currently, but you can cancel and restart later. EasyRip detects incomplete backups.

---

**END OF SCRIPT**

**Total Word Count:** ~4,200 words
**Estimated Speaking Time:** 14-15 minutes at conversational pace
**Production Complexity:** Medium (requires screen recording, disc handling, and post-production editing)

**License:** This script is provided for use with the EasyRip project under the MIT License.
