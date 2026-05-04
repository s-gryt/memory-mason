#!/usr/bin/env bash

is_absolute_path() {
  case "$1" in
    /*|[A-Za-z]:[\\/]* )
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_workspace_dir() {
  local workspace_value="$1"

  if [ "$workspace_value" = "" ]; then
    pwd
    return
  fi

  if is_absolute_path "$workspace_value"; then
    if [ -d "$workspace_value" ]; then
      (cd "$workspace_value" && pwd)
      return
    fi

    echo "$workspace_value"
    return
  fi

  if [ -d "$workspace_value" ]; then
    (cd "$workspace_value" && pwd)
    return
  fi

  echo "$(pwd)/$workspace_value"
}

has_local_sources() {
  if [ "$SCRIPT_DIR" = "" ]; then
    return 1
  fi

  for runtime_file in "${HOOK_RUNTIME_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$runtime_file" ]; then
      return 1
    fi
  done

  for lib_file in "${LIB_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/lib/$lib_file" ]; then
      return 1
    fi
  done

  return 0
}
