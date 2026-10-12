'use client';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace';
import { ThemeProvider } from '@/lib/theme';
import { WorkspaceShell } from '@/components/workspace-shell';
function ThemedWorkspace(){const {user}=useWorkspace();return <ThemeProvider userKey={user?.id||'guest'}><WorkspaceShell key={user?.id||'guest'}/></ThemeProvider>;}
export default function Page(){return <WorkspaceProvider><ThemedWorkspace/></WorkspaceProvider>;}
