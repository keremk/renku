/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, type ReactNode } from 'react';

export interface FileUriUploadContextValue {
  blueprintFolder: string | null;
  movieId: string | null;
}

const FileUriUploadContext = createContext<FileUriUploadContextValue | null>(
  null
);

export function FileUriUploadContextProvider(args: {
  blueprintFolder: string | null;
  movieId: string | null;
  children: ReactNode;
}) {
  return (
    <FileUriUploadContext.Provider
      value={{
        blueprintFolder: args.blueprintFolder,
        movieId: args.movieId,
      }}
    >
      {args.children}
    </FileUriUploadContext.Provider>
  );
}

export function useFileUriUploadContext(): FileUriUploadContextValue | null {
  return useContext(FileUriUploadContext);
}
