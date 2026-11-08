# Accessibility

Muse Shopping Index is built to be usable with a keyboard, a screen reader,
and low vision — not just with a mouse and full sight. This statement covers
the live demo and the Muse feature panel, the project's public surfaces.

## What is supported

- **Keyboard only:** every button and tab can be reached with Tab and
  activated with Enter or Space. Focus is always visible with a clear
  outline, and moving to a new view moves focus to that view's heading so a
  screen reader does not get lost. A "Skip to Reels" link at the top lets
  keyboard users skip the header.
- **Screen readers:** buttons and tabs carry labels and pressed states,
  product thumbnails carry alt text, dashboard numbers are labelled as
  numbers (not just pictures), and price changes are announced with an
  aria-live region instead of silently changing on screen.
- **Seeing the text:** the demo includes a text-size control and a
  high-contrast mode.
- **Motion:** the demo respects `prefers-reduced-motion` — animations and
  transitions are turned off for people who ask their device for less motion.
- **Hearing and understanding:** each Reel in the demo has a short written
  transcript describing what is in the video, so the demo does not depend on
  hearing audio or seeing the video alone.
- **Language:** a consumer review's language follows the explicit profile
  language preference first, device/Muse locale second, and location only as
  a fallback for locale, currency, tax, and shipping — never language guessed
  from location alone. If a review cannot be shown in a verified language, it
  fails closed instead of showing a guessed translation.

## Supported environments

The demo is tested on iPhone, tablet, and laptop screens in current browsers.
The README follows the same rules as the product: short sentences in the
plain-English section, real headings in order, lists instead of long
paragraphs, descriptive link text (never "click here"), and no meaning
carried by colour alone.

## Known limitations

- The glasses concept page is a labelled demonstrator: its point of view is
  simulated, so its visuals describe an intended experience, not a shipped
  assistive feature.
- Surfaces that are not live yet (for example, a production Muse host
  mounting the panel) cannot be assessed here; this statement covers what is
  actually shipped and reachable today.

## Reporting a barrier

If you find a part of the demo or README that cannot be used with a keyboard,
a screen reader, or large text, that is a bug in this project, not a
limitation of the reader. Please open an issue using the bug report template
and mention your assistive technology and browser so it can be reproduced:
https://github.com/DenzelR12/Muse-Shopping-Index/issues
