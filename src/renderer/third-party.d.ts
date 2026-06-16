// Ambient declarations for third-party packages that ship no TypeScript types.

declare module 'react-world-flags' {
  import * as React from 'react';

  interface FlagProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    /** ISO 3166-1 alpha-2/alpha-3 or numeric country code. */
    code?: string;
    /** Rendered when the code does not resolve to a flag. */
    fallback?: React.ReactNode;
  }

  const Flag: React.FC<FlagProps>;
  export default Flag;
}
