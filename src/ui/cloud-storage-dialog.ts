import { Button, Container, Label, TextInput } from 'pcui';
import { Events } from '../events';
import { localize } from './localization';

interface CloudSaveSettings {
    filename: string;
}

class CloudStorageDialog extends Container {
    private resolve: (value: CloudSaveSettings | null) => void;
    show: () => Promise<CloudSaveSettings | null>;
    hide: () => void;

    constructor(events: Events) {
        super({
            class: 'settings-dialog',
            hidden: true
        });

        const dialog = new Container({
            id: 'dialog'
        });

        // Header
        const header = new Container({ id: 'header' });
        const headerText = new Label({ 
            id: 'text', 
            text: localize('cloud.storage-title') 
        });
        header.append(headerText);

        // Content
        const content = new Container({ id: 'content' });
        const filenameRow = new Container({ class: 'row' });
        const filenameLabel = new Label({ 
            class: 'label', 
            text: localize('export.filename') 
        });
        const filenameInput = new TextInput({ 
            class: 'text-input',
            value: 'scene.ssproj'
        });
        filenameRow.append(filenameLabel);
        filenameRow.append(filenameInput);
        content.append(filenameRow);

        // Footer  
        const footer = new Container({ id: 'footer' });
        const cancelButton = new Button({
            text: localize('popup.cancel')
        });
        const saveButton = new Button({
            text: localize('cloud.save')
        });
        footer.append(cancelButton);
        footer.append(saveButton);

        dialog.append(header);
        dialog.append(content);
        dialog.append(footer);
        this.append(dialog);

        // Handle dialog actions
        cancelButton.on('click', () => {
            this.hide();
            this.resolve?.(null);
        });

        saveButton.on('click', () => {
            const settings: CloudSaveSettings = {
                filename: filenameInput.value
            };
            this.hide();
            this.resolve?.(settings);
        });

        // Close on escape key
        this.on('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
                this.resolve?.(null);
            }
        });

        // Public methods
        this.show = () => {
            return new Promise<CloudSaveSettings | null>((resolve) => {
                this.resolve = resolve;
                this.hidden = false;
                
                // Set initial filename from current document if available
                const currentName = events.invoke('doc.name');
                if (currentName) {
                    filenameInput.value = currentName;
                }
                
                // Focus the filename input
                filenameInput.focus();
            });
        };

        this.hide = () => {
            this.hidden = true;
            this.resolve = null;
        };
    }

    destroy() {
        this.hide();
        super.destroy();
    }
}

export { CloudStorageDialog, CloudSaveSettings };