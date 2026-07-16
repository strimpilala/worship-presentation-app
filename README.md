# Scripture Presenter

An open-source **EasyWorship-style** worship presentation app built with Electron.

**Features:**
- Fast scripture search (reference + phrase)
- Voice search support (microphone)
- Multi-version Bible display (KJV, ASV, BBE, WEB, YLT)
- Preview → Go Live workflow
- Mobile Remote (phone/tablet control via same WiFi)
- Schedule / set list builder
- Live projector window with themes & background images
- Web fallback for vague voice searches (e.g. "love is patient", "golden rule")

---

## Quick Start

1. Download and install the latest release.
2. Run the app.
3. Click **"Open Live Display"** to open the projector window.
4. Use the **Remote** button to get a QR code for your phone.

---

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) file.

### Bible Data Credits
- Public domain Bible translations (KJV, ASV, BBE, WEB, YLT).
- Database structure based on [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases).

---

## How Vague Voice Search Works

The app first tries local database search.  
If results are few, it automatically falls back to web Bible search for better handling of vague references like:
- "love is patient"
- "golden rule"
- "do not worry about tomorrow"
- "seventy times seven"

---

## Project Structure
