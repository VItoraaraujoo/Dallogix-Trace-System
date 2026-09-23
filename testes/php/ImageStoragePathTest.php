<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../scripts/image_storage_path.php';

final class ImageStoragePathTest extends TestCase
{
    public function testResolveArquivoRelativoNaPastaDeEvidencias(): void
    {
        $storage = sys_get_temp_dir() . '/trace-image-path-' . bin2hex(random_bytes(6));
        $folder = $storage . '/company_1/equipment_7';
        mkdir($folder, 0700, true);
        $image = $folder . '/incident.jpg';
        $outsideLink = $folder . '/outside.jpg';
        file_put_contents($image, 'image-fixture');
        symlink('/etc/hosts', $outsideLink);
        try {
            self::assertSame(realpath($image), trace_image_storage_path($storage, 'company_1/equipment_7/incident.jpg'));
            self::assertSame(realpath($image), trace_image_storage_path($storage, 'armazenamento/company_1/equipment_7/incident.jpg'));
            self::assertNull(trace_image_storage_path($storage, 'company_1/equipment_7/missing.jpg'));
            self::assertNull(trace_image_storage_path($storage, '/../other.jpg'));
            self::assertNull(trace_image_storage_path($storage, 'company_1/equipment_7/outside.jpg'));
        } finally {
            unlink($outsideLink);
            unlink($image);
            rmdir($folder);
            rmdir($storage . '/company_1');
            rmdir($storage);
        }
    }

    public function testCapturaSoAceitaArquivoRealDaSolicitacaoCorreta(): void
    {
        $storage = sys_get_temp_dir() . '/trace-camera-evidence-' . bin2hex(random_bytes(6));
        $folder = $storage . '/company_1/equipment_7';
        mkdir($folder, 0700, true);
        $content = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/NssAAAAASUVORK5CYII=',
            true,
        );
        $relative = 'company_1/equipment_7/capture-42-' . hash('sha256', $content) . '.png';
        $image = $storage . '/' . $relative;
        file_put_contents($image, $content);
        try {
            self::assertSame(realpath($image), trace_camera_evidence_path($storage, 1, 7, 42, $relative));
            self::assertNull(trace_camera_evidence_path($storage, 2, 7, 42, $relative));
            self::assertNull(trace_camera_evidence_path($storage, 1, 8, 42, $relative));
            self::assertNull(trace_camera_evidence_path($storage, 1, 7, 43, $relative));
            file_put_contents($image, 'not an image');
            self::assertNull(trace_camera_evidence_path($storage, 1, 7, 42, $relative));
        } finally {
            unlink($image);
            rmdir($folder);
            rmdir($storage . '/company_1');
            rmdir($storage);
        }
    }
}
