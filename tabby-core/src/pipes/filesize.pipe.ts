import { Pipe, PipeTransform } from '@angular/core'
import { filesize } from 'filesize'

@Pipe({ name: 'filesize', standalone: true })
export class FilesizePipe implements PipeTransform {
    transform (value: number|null|undefined): string {
        return filesize(value ?? 0, { base: 10, standard: 'si' })
    }
}
