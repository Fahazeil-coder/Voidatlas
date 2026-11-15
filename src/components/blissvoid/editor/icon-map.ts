"use client";

import * as React from "react";
import {
  // Node catalog icons
  Zap,
  Bolt,
  Database,
  Blocks,
  Webhook,
  Clock,
  TextCursorInput,
  MessagesSquare,
  Siren,
  Globe,
  Slack,
  Mail,
  NotebookPen,
  Table2,
  Send,
  Bot,
  Github,
  CreditCard,
  GitBranch,
  Shuffle,
  Merge,
  Timer,
  Repeat,
  Braces,
  Filter,
  FileCode2,
  ArrowDownWideNarrow,
  Sigma,
  Sparkles,
  ScrollText,
  Tags,
  HeartPulse,
  Reply,
  CircleDashed,
  Play,
  // Common editor chrome
  Search,
  Plus,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Save,
  Rocket,
  History,
  Trash2,
  Copy,
  Pin,
  PinOff,
  Wand2,
  Sparkle,
  Undo2,
  Redo2,
  RotateCcw,
  Download,
  Upload,
  CircleSlash,
  Command,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Settings2,
  StickyNote,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  MoreVertical,
  MoreHorizontal,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

/* ---------------------------------------------------------------------------
   Central icon registry for the BLISSVOID editor.
   Maps catalog icon names (strings persisted in data) to Lucide components.
   Unknown names fall back to CircleDashed.

   IMPORTANT: never render `const Icon = iconFor(name)` + <Icon /> inside a
   component body — that trips eslint react-hooks/static-components. Use the
   renderIcon() helper below, which resolves the component and mounts it via
   React.createElement in a single expression.
--------------------------------------------------------------------------- */

const ICONS: Record<string, LucideIcon> = {
  // Node catalog
  Zap,
  Bolt,
  Database,
  Blocks,
  Webhook,
  Clock,
  TextCursorInput,
  MessagesSquare,
  Siren,
  Globe,
  Slack,
  Mail,
  NotebookPen,
  Table2,
  Send,
  Bot,
  Github,
  CreditCard,
  GitBranch,
  Shuffle,
  Merge,
  Timer,
  Repeat,
  Braces,
  Filter,
  FileCode2,
  ArrowDownWideNarrow,
  Sigma,
  Sparkles,
  ScrollText,
  Tags,
  HeartPulse,
  Reply,
  CircleDashed,
  Play,
  // Editor chrome
  Search,
  Plus,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Save,
  Rocket,
  History,
  Trash2,
  Copy,
  Pin,
  PinOff,
  Wand2,
  Sparkle,
  Undo2,
  Redo2,
  RotateCcw,
  Download,
  Upload,
  CircleSlash,
  Command,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Settings2,
  StickyNote,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  MoreVertical,
  MoreHorizontal,
  Stethoscope,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? CircleDashed;
}

export type RenderIconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
};

/**
 * Resolves an icon name and renders it in a single call.
 * Use as `{renderIcon("Globe", { size: 13 })}` — safe for the
 * react-hooks/static-components rule.
 */
export function renderIcon(name: string, props?: RenderIconProps): React.ReactElement {
  const Cmp = iconFor(name);
  return React.createElement(Cmp, props ?? {});
}
