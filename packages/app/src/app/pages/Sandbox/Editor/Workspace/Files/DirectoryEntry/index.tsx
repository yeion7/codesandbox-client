import React from 'react';
import { DropTarget, DropTargetMonitor } from 'react-dnd';
import { NativeTypes } from 'react-dnd-html5-backend';
import { useOvermind } from 'app/overmind';
import { Alert } from 'app/components/Alert';
import Modal from 'app/components/Modal';
import { getChildren as calculateChildren } from '@codesandbox/common/lib/sandbox/modules';

import DirectoryChildren from './DirectoryChildren';
import { EntryContainer, Opener, Overlay } from './elements';
import Entry from './Entry';
import validateTitle from './validateTitle';

const readDataURL = (file: File): Promise<string | ArrayBuffer> =>
  new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      resolve(e.target.result);
    };
    reader.readAsDataURL(file);
  });

type parsedFiles = { [k: string]: { dataURI: string; type: string } };
const getFiles = async (files: File[] | FileList): Promise<parsedFiles> => {
  const returnedFiles = {};
  await Promise.all(
    Array.from(files)
      .filter(Boolean)
      .map(async file => {
        const dataURI = await readDataURL(file);
        // @ts-ignore
        returnedFiles[file.path || file.name] = {
          dataURI,
          type: file.type,
        };
      })
  );

  return returnedFiles;
};

type ItemTypes = 'module' | 'directory';
interface DeleteModal {
  type: ItemTypes;
  title: string;
  shortid: string;
}

interface Props {
  id: string;
  root: boolean;
  initializeProperties: Function;
  shortid: string;
  connectDropTarget: Function;
  isOver: boolean;
  depth: number;
  getModulePath: Function;
}

const DirectoryEntry: React.FunctionComponent<Props> = ({
  id,
  root,
  initializeProperties,
  shortid,
  connectDropTarget,
  isOver,
  depth = 0,
  getModulePath,
}) => {
  const {
    state: {
      isLoggedIn,
      editor: {
        currentSandbox: { modules, directories, privacy },
        shouldDirectoryBeOpen,
      },
    },
    actions: {
      files: {
        moduleCreated,
        moduleRenamed,
        directoryCreated,
        directoryRenamed,
        directoryDeleted,
        moduleDeleted,
        filesUploaded,
      },
      editor: { moduleSelected, moduleDoubleClicked, discardModuleChanges },
    },
    reaction,
  } = useOvermind();

  const [creating, setCreating] = React.useState<ItemTypes>(null);
  const [open, setOpen] = React.useState(root || shouldDirectoryBeOpen(id));
  const [deleteModal, setDeleteModal] = React.useState<DeleteModal | null>(
    null
  );

  React.useEffect(() => {
    if (initializeProperties) {
      initializeProperties({
        onCreateModuleClick,
        onCreateDirectoryClick,
        onUploadFileClick,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(
    () =>
      reaction(
        ({ editor }) => editor.currentModuleShortid,
        () => {
          setOpen(isOpen => isOpen || shouldDirectoryBeOpen(id));
        }
      ),
    [id, reaction, shouldDirectoryBeOpen]
  );

  React.useEffect(() => {
    if (isOver) {
      setOpen(true);
    }
  }, [isOver]);

  const resetState = () => setCreating(null);

  const onCreateModuleClick = () => {
    setCreating('module');
    setOpen(true);

    return true;
  };

  const createModule = (_, title: string) => {
    moduleCreated({
      title,
      directoryShortid: shortid,
    });

    resetState();
  };

  const renameModule = (moduleShortid: string, title: string) => {
    moduleRenamed({ moduleShortid, title });
  };

  const deleteModule = (moduleId: string, title: string) => {
    setDeleteModal({
      type: 'module',
      shortid: moduleId,
      title,
    });
  };

  const onCreateDirectoryClick = () => {
    setCreating('directory');
    setOpen(true);

    return true;
  };

  const createDirectory = (_, title: string) => {
    directoryCreated({
      title,
      directoryShortid: shortid,
    });
    resetState();
  };

  const onUploadFileClick = React.useCallback(() => {
    const fileSelector = document.createElement('input');
    fileSelector.setAttribute('type', 'file');
    fileSelector.setAttribute('multiple', 'true');
    fileSelector.onchange = async event => {
      const target = event.target as HTMLInputElement;
      const files = await getFiles(target.files);

      filesUploaded({
        files,
        directoryShortid: shortid,
      });
    };

    fileSelector.click();
  }, [filesUploaded, shortid]);

  const renameDirectory = (directoryShortid: string, title: string) => {
    directoryRenamed({ title, directoryShortid });
  };

  const closeModals = () => {
    setDeleteModal(null);
  };

  const deleteDirectory = () => {
    setDeleteModal({
      type: 'directory',
      title,
      shortid,
    });
  };

  const toggleOpen = () => setOpen(!open);

  const closeTree = () => setOpen(false);

  const validateModuleTitle = (moduleId: string, title: string) =>
    validateTitle(moduleId, title, getChildren());

  const validateDirectoryTitle = (directoryId: string, title: string) => {
    if (root) return null;

    return validateTitle(directoryId, title, getChildren());
  };

  const getChildren = () => calculateChildren(modules, directories, shortid);

  const setCurrentModule = (moduleId: string) => {
    moduleSelected({ id: moduleId });
  };

  const markTabsNotDirty = () => {
    moduleDoubleClicked();
  };

  const discardChanges = (moduleShortid: string) => {
    discardModuleChanges({ moduleShortid });

    return true;
  };

  const title = root ? 'Project' : directories.find(m => m.id === id).title;

  return connectDropTarget(
    <div style={{ position: 'relative' }}>
      <Overlay isOver={isOver} />
      {!root && (
        <EntryContainer>
          <Entry
            id={id}
            shortid={shortid}
            title={title}
            depth={depth}
            type={open ? 'directory-open' : 'directory'}
            root={root}
            isOpen={open}
            onClick={toggleOpen}
            renameValidator={validateDirectoryTitle}
            discardModuleChanges={discardChanges}
            rename={!root && renameDirectory}
            onCreateModuleClick={onCreateModuleClick}
            onCreateDirectoryClick={onCreateDirectoryClick}
            onUploadFileClick={isLoggedIn && privacy === 0 && onUploadFileClick}
            deleteEntry={!root && deleteDirectory}
            hasChildren={getChildren().length > 0}
            closeTree={closeTree}
            getModulePath={getModulePath}
          />
          {deleteModal && deleteModal.type === 'directory' && (
            <Modal isOpen onClose={closeModals} width={400}>
              <Alert
                title="Delete Directory"
                body={
                  <span>
                    Are you sure you want to delete <b>{deleteModal.title}</b>
                    ?
                    <br />
                    The directory will be permanently removed.
                  </span>
                }
                onCancel={closeModals}
                onConfirm={() => {
                  directoryDeleted({
                    directoryShortid: deleteModal.shortid,
                  });

                  setDeleteModal(null);
                }}
              />
            </Modal>
          )}
        </EntryContainer>
      )}
      <Opener open={open}>
        {creating === 'directory' && (
          <Entry
            id=""
            title=""
            state="editing"
            type="directory"
            depth={depth + 1}
            renameValidator={validateModuleTitle}
            rename={createDirectory}
            onRenameCancel={resetState}
          />
        )}
        <DirectoryChildren
          depth={depth}
          renameModule={renameModule}
          parentShortid={shortid}
          renameValidator={validateModuleTitle}
          deleteEntry={deleteModule}
          setCurrentModule={setCurrentModule}
          markTabsNotDirty={markTabsNotDirty}
          discardModuleChanges={discardChanges}
          getModulePath={getModulePath}
        />
        {deleteModal && deleteModal.type === 'module' && (
          <Modal isOpen onClose={closeModals} width={400}>
            <Alert
              css={`
                background-color: ${props =>
                  props.theme['sideBar.background'] || 'auto'};
                color: ${props =>
                  props.theme.light
                    ? 'rgba(0,0,0,0.9)'
                    : 'rgba(255,255,255,0.9)'};
              `}
              title="Delete File"
              body={
                <span>
                  Are you sure you want to delete{' '}
                  <b
                    css={`
                      word-break: break-all;
                    `}
                  >
                    {deleteModal.title}
                  </b>
                  ?
                  <br />
                  The file will be permanently removed.
                </span>
              }
              onCancel={closeModals}
              onConfirm={() => {
                moduleDeleted({
                  moduleShortid: deleteModal.shortid,
                });

                setDeleteModal(null);
              }}
            />
          </Modal>
        )}
        {creating === 'module' && (
          <Entry
            id=""
            title=""
            state="editing"
            depth={depth + 1}
            renameValidator={validateModuleTitle}
            rename={createModule}
            onRenameCancel={resetState}
          />
        )}
      </Opener>
    </div>
  );
};

const entryTarget = {
  drop: (props, monitor) => {
    if (monitor == null) return;

    // Check if only child is selected:
    if (!monitor.isOver({ shallow: true })) return;

    const sourceItem = monitor.getItem();
    if (sourceItem.dirContent) {
      sourceItem.dirContent.then(async droppedFiles => {
        const files = await getFiles(droppedFiles);

        props.signals.files.filesUploaded({
          files,
          directoryShortid: props.shortid,
        });
      });
    } else if (sourceItem.directory) {
      props.signals.files.directoryMovedToDirectory({
        shortid: sourceItem.shortid,
        directoryShortid: props.shortid,
      });
    } else {
      props.signals.files.moduleMovedToDirectory({
        moduleShortid: sourceItem.shortid,
        directoryShortid: props.shortid,
      });
    }
  },

  canDrop: (props, monitor) => {
    if (monitor == null) return false;
    const source = monitor.getItem();
    if (source == null) return false;

    if (source.id === props.id) return false;
    return true;
  },
};

function collectTarget(connectMonitor, monitor: DropTargetMonitor) {
  return {
    // Call this function inside render()
    // to let React DnD handle the drag events:
    connectDropTarget: connectMonitor.dropTarget(),
    // You can ask the monitor about the current drag state:
    isOver: monitor.isOver({ shallow: true }),
    canDrop: monitor.canDrop(),
    itemType: monitor.getItemType(),
  };
}

// eslint-disable-next-line import/no-default-export
export default DropTarget(
  ['ENTRY', NativeTypes.FILE],
  entryTarget,
  collectTarget
)(React.memo(DirectoryEntry));
