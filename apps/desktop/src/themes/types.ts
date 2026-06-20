// apps/desktop/src/themes/types.ts

export interface ThemeColors {
  surface: {
    primary: string;
    elevated: string;
    surface2?: string;
    surface3?: string;
    overlay: string;
    input: string;
    muted: string;
    sidebar: string;
    floating: string;
  };
  content: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
    link: string;
  };
  border: {
    color: string;
    subtle: string;
    hairline?: string;
    hairlineStrong?: string;
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
  code: {
    blockBg: string;
    blockBorder: string;
    blockColor: string;
    inlineBg: string;
    inlineColor: string;
  };
  syntax: {
    keyword: string;
    string: string;
    number: string;
    comment: string;
    function: string;
    variable: string;
    tag: string;
  };
  graph: {
    entityPerson: string;
    entityProject: string;
    entityConcept: string;
    entityTechnology: string;
    entityDecision: string;
    entityMemory: string;
    edgeActive: string;
    edgeInactive: string;
    nodeLabel: string;
    bgGrid: string;
    minimapMask: string;
  };
  chart: {
    c1: string;
    c2: string;
    c3: string;
    c4: string;
    c5: string;
    c6: string;
    c7: string;
    c8: string;
  };
  brand: {
    accent: string;
    success: string;
    danger: string;
    warning: string;
    info: string;
    purple: string;
  };
  icon: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export interface ThemeStyle {
  radius: { sm: string; md: string; lg: string; xl: string };
  shadow: { xs?: string; sm: string; md: string; lg: string; popover: string; modal: string };
  font: {
    family: string;
    display: string;
    mono?: string;
    letterSpacing: string;
    lineHeight: string;
    sizeBase: string;
    sizeSm: string;
    sizeXs: string;
    sizeLg: string;
    sizeXl: string;
    size2xl: string;
    weightNormal: string;
    weightMedium: string;
    weightBold: string;
  };
  border: { width: string; style: string };
  transition: { duration: string; fast: string; slow: string; easing: string };
  opacity: { hover: string; disabled: string; overlay: string };
  glass: { blur: string; opacity: string };
  focusRing: { width: string; color: string; offset: string };
  selection: { bg: string; fg: string };
  scrollbar: { width: string; thumb: string; track: string };
  bodyBg: string;
}

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  style: ThemeStyle;
}
