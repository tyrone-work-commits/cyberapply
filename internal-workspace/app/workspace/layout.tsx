import type {ReactNode} from 'react';
// Post-sign-in metadata only; the protected entry layout stays unchanged.
export const metadata={manifest:'/manifest.webmanifest'};
export default function WorkspaceLayout({children}:{children:ReactNode}){return <>{children}</>;}
