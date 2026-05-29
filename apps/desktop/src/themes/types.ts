// apps/desktop/src/themes/types.ts

export interface ThemeColors {
  surface: {
    primary: string;
    elevated: string;
    overlay: string;
    input: string;
    muted: string;
  };
  content: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
  };
  border: {
    color: string;
    subtle: string;
  };
  accent: {
    base: string;
    hover: string;
    muted: string;
    foreground: string;
  };
  intent: {
    success: { color: string; muted: string; foreground: string };
    danger: { color: string; muted: string; foreground: string };
    warning: { color: string; muted: string; foreground: string };
    info: { color: string; muted: string; foreground: string };
    purple: { color: string; muted: string; foreground: string };
  };
}

export interface ThemeStyle {
  radius: { sm: string; md: string; lg: string; xl: string };
  shadow: { sm: string; md: string; lg: string };
  font: { family: string; display: string; letterSpacing: string; lineHeight: string };
  border: { width: string };
  transition: { duration: string; easing: string };
  opacity: { hover: string; disabled: string; overlay: string };
  glass: { blur: string; opacity: string };
  focusRing: { width: string; color: string; offset: string };
  selection: { bg: string; fg: string };
  scrollbar: { width: string; thumb: string; track: string };
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  style: ThemeStyle;
}
