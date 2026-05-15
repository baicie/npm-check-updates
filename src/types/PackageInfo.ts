import { PackageFile } from './PackageFile'

/** Describes package data plus it's filepath */
export interface PackageInfo {
  name?: string
  pkg: PackageFile
  pkgFile: string // the raw file string
  filepath: string
  /** Catalog name if this package info represents a catalog (e.g., "default", "test"). */
  catalogName?: string
}
