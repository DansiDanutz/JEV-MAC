# JEV-MAC dashboard design system

## Color

- Canvas: `#f3f5f2`
- Surface: `#ffffff`
- Surface muted: `#f7f8f6`
- Ink: `#18201d`
- Ink secondary: `#5f6b66`
- Border: `#dce2dd`
- Accent: `#286a50`
- Accent soft: `#e3f0e9`
- Warning: `#9a5b13`
- Warning soft: `#fff3dc`
- Danger: `#a13f3b`
- Danger soft: `#fbe9e7`
- Info: `#3e668a`
- Shadow: `0 14px 36px rgba(35, 48, 42, 0.07)`

## Typography

- Family: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Display: 30px / 1.15, weight 680, letter spacing -0.03em
- Heading: 18px / 1.3, weight 650
- Body: 14px / 1.55, weight 430
- Label: 12px / 1.3, weight 620, letter spacing 0.02em
- Monospace paths: `ui-monospace, SFMono-Regular, Menlo, monospace`

## Layout

- Sidebar: 244px fixed desktop width
- Main maximum readable width: 1440px
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px
- Card radius: 16px; control radius: 10px; pill radius: 999px
- Minimum interactive target: 40px
- Responsive breakpoint: 820px; sidebar becomes a horizontal navigation rail

## Components

- Cards use white surface, one-pixel border, and restrained shadow.
- Primary actions use the accent; secondary actions are white with border.
- Destructive or mutation-adjacent actions are never icon-only and always state consequences.
- Status pills pair color with text, never color alone.
- Tables become stacked records on narrow screens; paths wrap anywhere.
- Focus rings use a 3px translucent accent outline.
- Dialogs use a dim neutral scrim and preserve context beneath them.

## Mood

Calm, local, and trustworthy: warm-neutral light surfaces, generous whitespace, plain language,
and no decorative or fabricated analytics. Every number comes from the local service state.
