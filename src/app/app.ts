import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { jsPDF } from 'jspdf';

type Theme = 'light' | 'dark';

type NoteItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements AfterViewInit {
  @ViewChild('editor', { static: true })
  private editorRef!: ElementRef<HTMLDivElement>;

  @ViewChild('imageInput', { static: true })
  private imageInputRef!: ElementRef<HTMLInputElement>;

  @ViewChild('importInput', { static: true })
  private importInputRef!: ElementRef<HTMLInputElement>;

  noteTitle = 'Ma note';
  theme: Theme = 'light';
  lastSavedAt = '';
  wordCount = 0;
  charCount = 0;
  notes: NoteItem[] = [];
  selectedNoteId = '';

  private savedRange: Range | null = null;

  private readonly notesKey = 'notes-notes';
  private readonly selectedNoteKey = 'notes-selected-note';
  private readonly themeKey = 'notes-theme';
  private readonly savedAtKey = 'notes-saved-at';

  ngAfterViewInit(): void {
    this.restoreState();
    this.ensureAtLeastOneNote();
    this.loadSelectedNoteIntoEditor();
    this.updateStats();
    this.applyTheme();
  }

  get sortedNotes(): NoteItem[] {
    return [...this.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  applyCommand(command: string, value?: string): void {
    this.restoreSelection();
    this.focusEditor();

    if (value !== undefined) {
      document.execCommand(command, false, value);
    } else {
      document.execCommand(command, false);
    }

    this.afterEditorChange();
  }

  setTextColor(color: string): void {
    this.applyCommand('foreColor', color);
  }

  setFontFamily(font: string): void {
    this.applyCommand('fontName', font);
  }

  changeFontSize(size: string): void {
    this.restoreSelection();
    this.focusEditor();

    document.execCommand('fontSize', false, '7');

    this.editorRef.nativeElement
      .querySelectorAll('font[size="7"]')
      .forEach((node) => {
        node.removeAttribute('size');
        (node as HTMLElement).style.fontSize = size;
      });

    this.afterEditorChange();
  }

  triggerImagePicker(): void {
    this.saveSelection();
    this.imageInputRef.nativeElement.click();
  }

  insertImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const imageDataUrl = reader.result as string;
      this.restoreSelection();
      this.focusEditor();
      document.execCommand('insertImage', false, imageDataUrl);

      const images = this.editorRef.nativeElement.querySelectorAll('img');
      const lastImage = images[images.length - 1] as HTMLImageElement | undefined;
      if (lastImage) {
        lastImage.style.maxWidth = '100%';
        lastImage.style.display = 'block';
        lastImage.style.margin = '12px 0';
        lastImage.style.borderRadius = '10px';
      }

      this.afterEditorChange();
    };

    reader.readAsDataURL(file);
    input.value = '';
  }

  duplicateSelection(): void {
    this.restoreSelection();
    this.focusEditor();

    const selectedText = window.getSelection()?.toString();
    if (!selectedText) {
      return;
    }

    document.execCommand('insertText', false, `${selectedText} ${selectedText}`);
    this.afterEditorChange();
  }

  clearFormatting(): void {
    this.applyCommand('removeFormat');
  }

  toggleTheme(): void {
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(this.themeKey, this.theme);
    this.applyTheme();
  }

  createNote(): void {
    this.saveCurrentNote();

    const note = this.createEmptyNote(`Note ${this.notes.length + 1}`);
    this.notes.unshift(note);
    this.selectedNoteId = note.id;
    this.noteTitle = note.title;
    this.editorRef.nativeElement.innerHTML = note.content;

    this.saveNotes();
    this.updateStats();
    this.focusEditor();
  }

  selectNote(noteId: string): void {
    if (noteId === this.selectedNoteId) {
      return;
    }

    this.saveCurrentNote();
    this.selectedNoteId = noteId;
    this.loadSelectedNoteIntoEditor();
    this.updateStats();
    this.saveNotes();
  }

  deleteNote(noteId: string): void {
    if (this.notes.length <= 1) {
      return;
    }

    const target = this.notes.find((note) => note.id === noteId);
    const noteLabel = target?.title ?? 'cette note';
    if (!confirm(`Supprimer ${noteLabel} ?`)) {
      return;
    }

    this.notes = this.notes.filter((note) => note.id !== noteId);

    if (noteId === this.selectedNoteId) {
      this.selectedNoteId = this.notes[0].id;
      this.loadSelectedNoteIntoEditor();
      this.updateStats();
    }

    this.saveNotes();
  }

  onTitleChange(title: string): void {
    this.noteTitle = title || 'Sans titre';
    this.saveCurrentNote();
  }

  saveSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    this.savedRange = selection.getRangeAt(0);
  }

  onEditorInput(): void {
    this.saveCurrentNote();
    this.updateStats();
  }

  exportAsHtml(): void {
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${this.escapeHtml(this.noteTitle)}</title></head><body>${this.editorRef.nativeElement.innerHTML}</body></html>`;
    this.downloadFile(`${this.fileSafeName(this.noteTitle)}.html`, html, 'text/html');
  }

  exportAsText(): void {
    const text = this.editorRef.nativeElement.innerText;
    this.downloadFile(`${this.fileSafeName(this.noteTitle)}.txt`, text, 'text/plain');
  }

  exportAsPdf(): void {
    const doc = new jsPDF();
    const text = this.editorRef.nativeElement.innerText || '';

    doc.setFontSize(18);
    doc.text(this.noteTitle || 'Sans titre', 14, 18);

    doc.setFontSize(11);
    const lines = doc.splitTextToSize(text || '(note vide)', 180);
    doc.text(lines, 14, 30);

    doc.save(`${this.fileSafeName(this.noteTitle)}.pdf`);
  }

  triggerImport(): void {
    this.importInputRef.nativeElement.click();
  }

  importTextFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      this.editorRef.nativeElement.innerText = content;
      this.afterEditorChange();
    };

    reader.readAsText(file);
    input.value = '';
  }

  notePreview(content: string): string {
    const temp = document.createElement('div');
    temp.innerHTML = content;
    const text = (temp.textContent || '').replace(/\s+/g, ' ').trim();

    if (!text) {
      return 'Note vide';
    }

    return text.length > 70 ? `${text.slice(0, 70)}...` : text;
  }

  private afterEditorChange(): void {
    this.saveSelection();
    this.saveCurrentNote();
    this.updateStats();
  }

  private saveCurrentNote(): void {
    const current = this.currentNote();
    if (!current) {
      return;
    }

    current.title = this.noteTitle || 'Sans titre';
    current.content = this.editorRef.nativeElement.innerHTML;
    current.updatedAt = new Date().toISOString();

    this.lastSavedAt = new Date().toLocaleTimeString();
    localStorage.setItem(this.savedAtKey, this.lastSavedAt);

    this.saveNotes();
  }

  private saveNotes(): void {
    localStorage.setItem(this.notesKey, JSON.stringify(this.notes));
    localStorage.setItem(this.selectedNoteKey, this.selectedNoteId);
  }

  private restoreState(): void {
    const savedNotes = localStorage.getItem(this.notesKey);
    const savedSelectedId = localStorage.getItem(this.selectedNoteKey);
    const savedTheme = localStorage.getItem(this.themeKey) as Theme | null;
    const savedAt = localStorage.getItem(this.savedAtKey);

    if (savedNotes) {
      try {
        const parsed = JSON.parse(savedNotes) as NoteItem[];
        if (Array.isArray(parsed)) {
          this.notes = parsed.filter((note) => note && note.id && note.title !== undefined && note.content !== undefined && note.updatedAt);
        }
      } catch {
        this.notes = [];
      }
    } else {
      const legacyContent = localStorage.getItem('notes-content');
      const legacyTitle = localStorage.getItem('notes-title');

      if (legacyContent || legacyTitle) {
        this.notes = [
          {
            id: this.generateId(),
            title: legacyTitle || 'Ma note',
            content: legacyContent || 'Ecris ta note ici...',
            updatedAt: new Date().toISOString()
          }
        ];
      }
    }

    if (savedSelectedId) {
      this.selectedNoteId = savedSelectedId;
    }

    if (savedTheme === 'light' || savedTheme === 'dark') {
      this.theme = savedTheme;
    }

    if (savedAt) {
      this.lastSavedAt = savedAt;
    }
  }

  private ensureAtLeastOneNote(): void {
    if (this.notes.length === 0) {
      const first = this.createEmptyNote('Ma note');
      this.notes = [first];
      this.selectedNoteId = first.id;
      this.saveNotes();
      return;
    }

    const stillExists = this.notes.some((note) => note.id === this.selectedNoteId);
    if (!stillExists) {
      this.selectedNoteId = this.notes[0].id;
    }
  }

  private loadSelectedNoteIntoEditor(): void {
    const current = this.currentNote();
    if (!current) {
      return;
    }

    this.noteTitle = current.title || 'Sans titre';
    this.editorRef.nativeElement.innerHTML = current.content || 'Ecris ta note ici...';
  }

  private currentNote(): NoteItem | undefined {
    return this.notes.find((note) => note.id === this.selectedNoteId);
  }

  private createEmptyNote(title: string): NoteItem {
    return {
      id: this.generateId(),
      title,
      content: 'Ecris ta note ici...',
      updatedAt: new Date().toISOString()
    };
  }

  private restoreSelection(): void {
    if (!this.savedRange) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(this.savedRange);
  }

  private focusEditor(): void {
    this.editorRef.nativeElement.focus();
  }

  private updateStats(): void {
    const text = this.editorRef.nativeElement.innerText || '';
    const normalized = text.replace(/\s+/g, ' ').trim();

    this.wordCount = normalized ? normalized.split(' ').length : 0;
    this.charCount = text.trim().length;
  }

  private applyTheme(): void {
    document.body.classList.toggle('dark-theme', this.theme === 'dark');
  }

  private downloadFile(fileName: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.click();

    URL.revokeObjectURL(url);
  }

  private fileSafeName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
