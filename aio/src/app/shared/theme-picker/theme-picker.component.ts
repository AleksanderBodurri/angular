import { Component, OnInit } from '@angular/core';
import { StyleManager } from './style-manager';
import { ThemeStorage } from './theme-storage/theme-storage';

@Component({
  selector: 'aio-theme-picker',
  templateUrl: './theme-picker.component.html',
  providers: [ThemeStorage, StyleManager]
})
export class ThemePickerComponent implements OnInit {

  currentTheme: 'light' | 'dark' = 'light';

  constructor(private _themeStorage: ThemeStorage, private _styleManager: StyleManager) { }

  ngOnInit(): void {
    const theme = this._themeStorage.getStoredThemeName();
    if (theme) {
      this.selectTheme(theme);
    }
  }

  get nextTheme(): 'light' | 'dark' {
    return { light: 'dark', dark: 'light' }[this.currentTheme] as 'light' | 'dark';
  }

  get ariaLabel(): string {
    return `Turn on ${this.nextTheme} mode.`;
  }

  selectTheme(theme: string) {
    this.currentTheme = theme as 'light' | 'dark';

    if (theme === 'light') {
      this._styleManager.removeStyle('theme');
    } else {
      this._styleManager.setStyle('theme', `assets/${theme}.css`);
    }

    if (this.currentTheme) {
      this._themeStorage.storeTheme(this.currentTheme);
    }
  }
}
