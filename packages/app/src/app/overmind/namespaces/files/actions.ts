import { getModulePath } from '@codesandbox/common/lib/sandbox/modules';
import getDefinition from '@codesandbox/common/lib/templates';
import { ModuleTab } from '@codesandbox/common/lib/types';
import { AsyncAction } from 'app/overmind';
import { withOwnedSandbox } from 'app/overmind/factories';
import { createOptimisticModule } from 'app/overmind/utils/common';
import { INormalizedModules } from 'codesandbox-import-util-types';
import denormalize from 'codesandbox-import-utils/lib/utils/files/denormalize';

import {
  resolveDirectoryWrapped,
  resolveModuleWrapped,
} from '../../utils/resolve-module-wrapped';
import * as internalActions from './internalActions';

export const internal = internalActions;

export const moduleRenamed: AsyncAction<{
  title: string;
  moduleShortid: string;
}> = withOwnedSandbox(
  async ({ state, effects, actions }, { title, moduleShortid }) => {
    const sandbox = state.editor.currentSandbox;
    const module = sandbox.modules.find(
      moduleItem => moduleItem.shortid === moduleShortid
    );

    if (!module) {
      return;
    }

    const oldTitle = module.title;

    module.title = title;

    try {
      await effects.api.saveModuleTitle(sandbox.id, moduleShortid, title);

      if (state.live.isCurrentEditor) {
        effects.live.sendModuleUpdate(module);
      }
    } catch (error) {
      module.title = oldTitle;
      effects.notificationToast.error('Could not rename file');
    }
  }
);

export const directoryCreated: AsyncAction<{
  title: string;
  directoryShortid: string;
}> = withOwnedSandbox(
  async ({ state, effects, actions }, { title, directoryShortid }) => {
    const sandbox = state.editor.currentSandbox;
    const optimisticDirectory = {
      id: effects.utils.createOptimisticId(),
      title,
      directoryShortid,
      shortid: effects.utils.createOptimisticId(),
      sourceId: state.editor.currentSandbox.sourceId,
      insertedAt: new Date().toString(),
      updatedAt: new Date().toString(),
      type: 'directory' as 'directory',
    };

    sandbox.directories.push(optimisticDirectory);

    try {
      const newDirectory = await effects.api.createDirectory(
        sandbox.id,
        directoryShortid,
        title
      );
      const directory = state.editor.currentSandbox.directories.find(
        directoryItem => directoryItem.shortid === optimisticDirectory.shortid
      );

      Object.assign(directory, {
        id: newDirectory.id,
        shortid: newDirectory.shortid,
      });

      effects.live.sendDirectoryCreated(newDirectory);
    } catch (error) {
      const directoryIndex = state.editor.currentSandbox.directories.findIndex(
        directoryItem => directoryItem.shortid === optimisticDirectory.shortid
      );

      sandbox.directories.splice(directoryIndex, 1);
      effects.notificationToast.error('Unable to save new directory');
    }
  }
);

export const moduleMovedToDirectory: AsyncAction<{
  moduleShortid: string;
  directoryShortid: string;
}> = withOwnedSandbox(
  async ({ state, effects, actions }, { moduleShortid, directoryShortid }) => {
    const sandbox = state.editor.currentSandbox;
    const module = sandbox.modules.find(
      moduleItem => moduleItem.shortid === moduleShortid
    );

    if (!module) {
      return;
    }

    const currentDirectoryShortid = module.directoryShortid;

    module.directoryShortid = directoryShortid;

    try {
      await effects.api.saveModuleDirectory(
        sandbox.id,
        moduleShortid,
        directoryShortid
      );
      effects.live.sendModuleUpdate(module);
    } catch (error) {
      module.directoryShortid = currentDirectoryShortid;

      effects.notificationToast.error('Could not save new module location');
    }
  }
);

export const directoryMovedToDirectory: AsyncAction<{
  shortid: string;
  directoryShortid: string;
}> = withOwnedSandbox(
  async ({ state, effects, actions }, { shortid, directoryShortid }) => {
    const sandbox = state.editor.currentSandbox;
    const directoryToMove = sandbox.directories.find(
      directoryItem => directoryItem.shortid === shortid
    );

    if (!directoryToMove) {
      return;
    }

    directoryToMove.directoryShortid = directoryShortid;

    try {
      await effects.api.saveDirectoryDirectory(
        sandbox.id,
        shortid,
        directoryShortid
      );
      effects.live.sendDirectoryUpdate(directoryToMove);
    } catch (error) {
      directoryToMove.directoryShortid = shortid;
      effects.notificationToast.error('Could not save new directory location');
    }
  }
);

export const directoryDeleted: AsyncAction<{
  directoryShortid;
}> = withOwnedSandbox(
  async ({ state, effects, actions }, { directoryShortid }) => {
    const sandbox = state.editor.currentSandbox;
    const directory = sandbox.directories.find(
      directoryItem => directoryItem.shortid === directoryShortid
    );

    if (!directory) {
      return;
    }

    const removedDirectory = sandbox.directories.splice(
      sandbox.directories.indexOf(directory),
      1
    )[0];

    state.editor.currentModuleShortid = state.editor.mainModule.shortid;

    try {
      await effects.api.deleteDirectory(
        state.editor.currentId,
        directoryShortid
      );
      effects.live.sendDirectoryDeleted(directoryShortid);
    } catch (error) {
      sandbox.directories.push(removedDirectory);
      effects.notificationToast.error('Could not delete directory');
    }
  }
);

export const directoryRenamed: AsyncAction<{
  title: string;
  directoryShortid: string;
}> = withOwnedSandbox(
  async ({ effects, state }, { title, directoryShortid }) => {
    const sandbox = state.editor.currentSandbox;
    const directory = sandbox.directories.find(
      directoryEntry => directoryEntry.shortid === directoryShortid
    );

    if (!directory) {
      return;
    }

    const oldTitle = directory.title;

    directory.title = title;

    try {
      await effects.api.saveDirectoryTitle(sandbox.id, directoryShortid, title);

      if (state.live.isCurrentEditor) {
        effects.live.sendDirectoryUpdate(directory);
      }
    } catch (error) {
      directory.title = oldTitle;
      effects.notificationToast.error('Could not rename directory');
    }
  }
);

export const gotUploadedFiles: AsyncAction<string> = async (
  { state, effects },
  message
) => {
  const modal = 'storageManagement';
  effects.analytics.track('Open Modal', { modal });
  state.currentModalMessage = message;
  state.currentModal = modal;

  try {
    const uploadedFilesInfo = await effects.api.getUploads();

    state.uploadedFiles = uploadedFilesInfo.uploads;
    state.maxStorage = uploadedFilesInfo.maxSize;
    state.usedStorage = uploadedFilesInfo.currentSize;
  } catch (error) {
    effects.notificationToast.error('Unable to get uploaded files information');
  }
};

export const addedFileToSandbox: AsyncAction<{
  url: string;
  name: string;
}> = withOwnedSandbox(async ({ actions }, { name, url }) => {
  actions.internal.closeModals(false);
  await actions.files.moduleCreated({
    title: name,
    directoryShortid: null,
    code: url,
    isBinary: true,
  });
});

export const deletedUploadedFile: AsyncAction<{
  id: string;
}> = withOwnedSandbox(async ({ state, effects }, { id }) => {
  const index = state.uploadedFiles.findIndex(file => file.id === id);
  const removedFiles = state.uploadedFiles.splice(index, 1);

  try {
    await effects.api.deleteUploadedFile(id);
  } catch (error) {
    state.uploadedFiles.splice(index, 0, ...removedFiles);
    effects.notificationToast.error('Unable to delete uploaded file');
  }
});

export const filesUploaded: AsyncAction<{
  files: { [k: string]: { dataURI: string; type: string } };
  directoryShortid: string;
}> = withOwnedSandbox(
  async ({ state, effects, actions }, { files, directoryShortid }) => {
    const modal = 'uploading';
    effects.analytics.track('Open Modal', { modal });
    // What message?
    // state.currentModalMessage = message;
    state.currentModal = modal;

    try {
      const { modules, directories } = await actions.files.internal.uploadFiles(
        {
          files,
          directoryShortid,
        }
      );

      await actions.files.massCreateModules({
        modules,
        directories,
        directoryShortid,
      });
    } catch (error) {
      if (error.message.indexOf('413') !== -1) {
        return;
      }
      effects.notificationToast.error(error.message);
    }

    actions.internal.closeModals(false);
  }
);

export const massCreateModules: AsyncAction<{
  modules: any;
  directories: any;
  directoryShortid: string | null;
  cbID?: string;
}> = withOwnedSandbox(
  async (
    { state, effects },
    { modules, directories, directoryShortid, cbID }
  ) => {
    const sandboxId = state.editor.currentId;

    try {
      const data = await effects.api.massCreateModules(
        sandboxId,
        directoryShortid,
        modules,
        directories
      );

      state.editor.currentSandbox.modules = state.editor.currentSandbox.modules.concat(
        data.modules
      );
      state.editor.currentSandbox.directories = state.editor.currentSandbox.directories.concat(
        data.directories
      );

      if (state.live.isCurrentEditor) {
        effects.live.sendMassCreatedModules(data.modules, data.directories);
      }

      if (cbID) {
        effects.vscode.callCallback(cbID);
      }
    } catch (error) {
      if (cbID) {
        effects.vscode.callCallbackError(cbID, error.message);
      }
      effects.notificationToast.error('Unable to create new files');
    }
  }
);

export const moduleCreated: AsyncAction<{
  title: string;
  directoryShortid: string | null;
  code?: string;
  isBinary?: boolean;
}> = withOwnedSandbox(
  async (
    { state, actions, effects },
    { title, directoryShortid, code, isBinary }
  ) => {
    const sandbox = state.editor.currentSandbox;
    const optimisticModule = createOptimisticModule({
      id: effects.utils.createOptimisticId(),
      title,
      directoryShortid: directoryShortid || null,
      shortid: effects.utils.createOptimisticId(),
      sourceId: sandbox.sourceId,
      isNotSynced: true,
      ...(code ? { code } : {}),
      ...(typeof isBinary === 'boolean' ? { isBinary } : {}),
    });

    sandbox.modules.push(optimisticModule);

    // We grab the module from the state to continue working with it (proxy)
    const module = sandbox.modules[sandbox.modules.length - 1];

    const path = getModulePath(sandbox.modules, sandbox.directories, module.id);
    const template = getDefinition(sandbox.template);
    const config = template.configurationFiles[path];

    if (
      config &&
      (config.generateFileFromSandbox ||
        config.getDefaultCode ||
        config.generateFileFromState)
    ) {
      if (config.generateFileFromState) {
        module.code = config.generateFileFromState(
          state.preferences.settings.prettierConfig
        );
      } else if (config.generateFileFromSandbox) {
        module.code = config.generateFileFromSandbox(sandbox);
      } else if (config.getDefaultCode) {
        const resolveModule = resolveModuleWrapped(sandbox);

        module.code = config.getDefaultCode(sandbox.template, resolveModule);
      }
    }

    try {
      const updatedModule = await effects.api.createModule(sandbox.id, module);

      module.id = updatedModule.id;
      module.shortid = updatedModule.shortid;

      actions.editor.internal.setCurrentModule(module);

      if (state.live.isCurrentEditor) {
        effects.live.sendModuleCreated(module);
      }
    } catch (error) {
      sandbox.modules.splice(sandbox.modules.indexOf(module), 1);
      actions.editor.internal.setCurrentModule(state.editor.mainModule);
      effects.notificationToast.error('Unable to save new file');
    }
  }
);

export const moduleDeleted: AsyncAction<{
  moduleShortid: string;
}> = async ({ state, effects, actions }, { moduleShortid }) => {
  const sandbox = state.editor.currentSandbox;
  const moduleToDeleteIndex = sandbox.modules.findIndex(
    module => module.shortid === moduleShortid
  );
  const removedModule = sandbox.modules.splice(moduleToDeleteIndex, 1)[0];

  actions.editor.internal.setCurrentModule(state.editor.mainModule);

  try {
    await effects.api.deleteModule(sandbox.id, moduleShortid);

    if (state.live.isCurrentEditor) {
      effects.live.sendModuleDeleted(moduleShortid);
    }
  } catch (error) {
    sandbox.modules.push(removedModule);
    effects.notificationToast.error('Could not delete file');
  }
};

export const createModulesByPath: AsyncAction<{
  cbID: string;
  files: INormalizedModules;
}> = async ({ state, actions }, { files, cbID }) => {
  const sandbox = state.editor.currentSandbox;

  const { modules, directories } = denormalize(files, sandbox.directories);

  await actions.files.massCreateModules({
    modules,
    directories,
    directoryShortid: null,
    cbID,
  });
};

export const syncSandbox: AsyncAction<any[]> = async (
  { state, effects },
  updates
) => {
  const id = state.editor.currentId;

  try {
    const newSandbox = await effects.api.getSandbox(id);
    const oldSandbox = state.editor.currentSandbox;

    updates.forEach(update => {
      const { op, path, type } = update;

      if (type === 'file') {
        const resolveModuleOld = resolveModuleWrapped(oldSandbox);
        const resolveModuleNew = resolveModuleWrapped(newSandbox);
        const oldModule = resolveModuleOld(path);
        if (op === 'update') {
          const newModule = resolveModuleNew(path);

          if (newModule) {
            if (oldModule) {
              const modulePos = oldSandbox.modules.indexOf(oldModule);
              Object.assign(
                state.editor.sandboxes[oldSandbox.id].modules[modulePos],
                newModule
              );
            } else {
              state.editor.sandboxes[oldSandbox.id].modules.push(newModule);
            }
          }
        } else if (op === 'delete' && oldModule) {
          oldSandbox.modules.splice(oldSandbox.modules.indexOf(oldModule), 1);
        }
      } else {
        const resolveDirectoryOld = resolveDirectoryWrapped(oldSandbox);
        const resolveDirectoryNew = resolveDirectoryWrapped(newSandbox);

        if (op === 'update') {
          // Create
          const newDirectory = resolveDirectoryNew(path);
          if (newDirectory) {
            state.editor.sandboxes[oldSandbox.id].directories.push(
              newDirectory
            );
          }
        } else {
          const oldDirectory = resolveDirectoryOld(path);
          if (oldDirectory) {
            const directory = oldSandbox.directories.find(
              directoryItem => directoryItem.shortid === oldDirectory.shortid
            );
            if (directory) {
              oldSandbox.directories.splice(
                oldSandbox.directories.indexOf(directory),
                1
              );
            }
          }
        }
      }
    });
  } catch (error) {
    if (error.response.status === 404) {
      return;
    }
    effects.notificationToast.error(
      "We weren't able to retrieve the latest files of the sandbox, please refresh"
    );
  }
};

export const removeModule: AsyncAction<{
  moduleShortid: string;
}> = withOwnedSandbox(
  async ({ state, effects, actions }, { moduleShortid }) => {
    if (state.editor.currentModule.shortid === moduleShortid) {
      actions.editor.internal.setCurrentModule(state.editor.mainModule);
    }

    const sandbox = state.editor.currentSandbox;
    const module = sandbox.modules.find(
      moduleEntry => moduleEntry.shortid === moduleShortid
    );

    if (!module) {
      return;
    }

    const tabs = state.editor.tabs as ModuleTab[];
    const tabIndex = module
      ? tabs.findIndex(tab => tab.moduleShortid === module.shortid)
      : -1;

    if (tabIndex >= 0) {
      actions.internal.closeTabByIndex(tabIndex);
    }

    sandbox.modules.splice(sandbox.modules.indexOf(module), 1);
  }
);

export const removeDirectory: AsyncAction<{
  directoryShortid: string;
}> = async ({ state }, { directoryShortid }) => {
  const sandbox = state.editor.currentSandbox;
  state.editor.currentModuleShortid = state.editor.mainModule.shortid;
  const directory = sandbox.directories.find(
    directoryItem => directoryItem.shortid === directoryShortid
  );

  if (!directory) {
    return;
  }

  sandbox.directories.splice(sandbox.directories.indexOf(directory), 1);
};
