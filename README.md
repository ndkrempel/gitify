# gitify

CLI tool for downloading a web site, especially for updating a git repository from it.

`gitify` will recursively download the files of a web site, and optionally commit the result to a local Git repository.

## Command-line arguments

| Name                   | Shorthand | Tyoe              | Description                                                                                         | Default
| ---------------------- | --------- | ----------------- | --------------------------------------------------------------------------------------------------- | -----------------------------------------
| `--base-url`           | `-b`      | string            | The URL prefix that all fetched files will lie under.                                               | `https://duel.neocities.org/concentric/`
| `--root`               | `-r`      | string (multiple) | The starting page(s) to begin the fetch from. Can be specified relative to the base URL.            | `maze.html`
| `--output-dir`         | `-o`      | string            | The directory to place the output files. Must be a Git repository unless `--no-git-commit` is used. | `out`
| `--branch`             | `-n`      | string            | The name of the Git branch to commit to.                                                            | `master`
| `--use-original-names` | `-u`      | boolean           | In case of redirect(s), name each file based on the original URL rather than the final one.         | `false`
| `--no-git-commit`      | `-g`      | boolean           | Don't run any Git commands, just download the files.                                                | `false`
| `--output-manifest`    | `-m`      | string            | Optionally write out a sorted list of all files downloaded to the specified file.                   | none
